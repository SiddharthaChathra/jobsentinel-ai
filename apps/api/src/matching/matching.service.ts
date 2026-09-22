import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import {
  buildJobRequirementsRequest,
  buildMatchRequest,
  type AIService,
  type JobRequirements,
} from '@jobsentinel/ai';
import type { JobStatus } from '@jobsentinel/types';
import {
  applyAiRefinement,
  scoreMatch,
  type MatchJob,
  type MatchProfile,
  type MatchScore,
} from '@jobsentinel/validation';
import { AI_SERVICE } from '../common/ai/ai.module';
import { DB, type Db } from '../common/db/db.module';
import {
  jobEvents,
  jobMatches,
  jobs,
  preferences,
  preferredRoles,
  profileSkills,
  profiles,
  skills,
  users,
} from '../common/db/schema';

export interface MatchRunResult {
  candidates: number;
  scored: number;
  aiUsed: number;
  aiUnavailable: number;
  byPriority: Record<string, number>;
  durationMs: number;
}

interface UserContext {
  userId: string;
  profileVersion: number;
  profile: MatchProfile;
  preferredRoleTitles: string[];
  experienceLevel: string;
  summary: string | null;
}

/** Below this deterministic score, an AI call is not worth the budget (docs 09 §5). */
const AI_PREFILTER_MIN = 35;
/**
 * Scores are written every N jobs rather than once at the end. AI refinement can stretch a batch
 * over many minutes, and holding the pooled connection idle that long loses it (D51).
 */
const FLUSH_EVERY = 50;
const FLUSH_AFTER_MS = 60_000;
/** Job statuses worth matching: validated, or awaiting the user's review. */
const MATCHABLE: JobStatus[] = ['VALID', 'NEEDS_REVIEW', 'MATCHED', 'NOTIFIED'];

/**
 * Pipeline stage VALID/NEEDS_REVIEW → MATCHED (docs 09 §5).
 * The deterministic scorer always runs and is stored; the AI only refines skill/role within
 * ±25 and only for jobs that already look plausible. A score never rejects a job.
 */
@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AI_SERVICE) private readonly ai: AIService | null,
  ) {}

  /**
   * `userIds`/`jobIds` scope a run to part of the data — used by the re-match script and by
   * tests. The worker always calls this unscoped.
   */
  async matchPending(
    opts: {
      batch?: number;
      maxAiCalls?: number;
      aiTimeBudgetMs?: number;
      userIds?: string[];
      jobIds?: string[];
    } = {},
  ): Promise<MatchRunResult> {
    const batch = opts.batch ?? 100;
    const maxAiCalls = opts.maxAiCalls ?? 15;
    const startedAt = Date.now();
    const aiDeadline = startedAt + (opts.aiTimeBudgetMs ?? 120_000);
    const result: MatchRunResult = {
      candidates: 0,
      scored: 0,
      aiUsed: 0,
      aiUnavailable: 0,
      byPriority: {},
      durationMs: 0,
    };

    const contexts = await this.userContexts(opts.userIds);
    if (contexts.length === 0) return { ...result, durationMs: Date.now() - startedAt };
    if (opts.jobIds?.length === 0) return { ...result, durationMs: Date.now() - startedAt };

    for (const ctx of contexts) {
      // Jobs this user has no current-version match for yet.
      const candidates = await this.db
        .select()
        .from(jobs)
        .where(
          and(
            inArray(jobs.status, MATCHABLE),
            ...(opts.jobIds ? [inArray(jobs.id, opts.jobIds)] : []),
            sql`not exists (select 1 from ${jobMatches} m where m.job_id = ${jobs.id} and m.user_id = ${ctx.userId} and m.profile_version = ${ctx.profileVersion})`,
          ),
        )
        .orderBy(jobs.firstSeenAt)
        .limit(batch);
      result.candidates += candidates.length;
      if (candidates.length === 0) continue;

      let rows: (typeof jobMatches.$inferInsert)[] = [];
      let matchedJobIds: string[] = [];
      let lastFlushAt = Date.now();
      const flush = async () => {
        if (rows.length === 0) return;
        await this.persist(rows, matchedJobIds);
        result.scored += rows.length;
        rows = [];
        matchedJobIds = [];
        lastFlushAt = Date.now();
      };

      for (const job of candidates) {
        const base = scoreMatch(ctx.profile, toMatchJob(job));
        let final = base;
        let usedAi = false;

        const worthAi =
          base.overall >= AI_PREFILTER_MIN && result.aiUsed < maxAiCalls && Date.now() < aiDeadline;
        if (worthAi) {
          const refined = await this.refineWithAi(ctx, job);
          if (refined.status === 'OK') {
            final = refined.score;
            usedAi = true;
            result.aiUsed++;
          } else if (refined.status === 'UNAVAILABLE') {
            result.aiUnavailable++;
          }
        }

        rows.push({
          jobId: job.id,
          userId: ctx.userId,
          profileVersion: ctx.profileVersion,
          overallScore: final.overall,
          skillScore: final.skillScore,
          roleScore: final.roleScore,
          experienceScore: final.experienceScore,
          locationScore: final.locationScore,
          priority: final.priority,
          matchedSkills: final.matchedSkills,
          missingSkills: final.missingSkills,
          explanation: final.explanation,
          ...(usedAi
            ? {
                aiProvider: this.ai?.primaryProvider.name ?? null,
                aiModel: this.ai?.primaryProvider.model ?? null,
                promptVersion: 'match.v1',
              }
            : {}),
        });
        matchedJobIds.push(job.id);
        result.byPriority[final.priority] = (result.byPriority[final.priority] ?? 0) + 1;
        // Row count bounds the transaction; elapsed time keeps a slow AI stretch from holding
        // the pooled connection open with nothing to do.
        if (rows.length >= FLUSH_EVERY || Date.now() - lastFlushAt > FLUSH_AFTER_MS) await flush();
      }

      await flush();
    }

    result.durationMs = Date.now() - startedAt;
    return result;
  }

  /**
   * Retries the AI refinement for matches that never got one because the budget was exhausted or
   * the provider was down — the `AI_PENDING` drain of docs 07 §1.4, expressed as "a match row at
   * the current profile version with no `ai_provider`" rather than as a job status (D53).
   *
   * Only rows above the pre-filter are eligible: a job that scored 12 was never meant to cost a
   * call, and must not start costing one here.
   */
  async refinePending(
    opts: { batch?: number; maxAiCalls?: number; aiTimeBudgetMs?: number; userIds?: string[] } = {},
  ): Promise<{ pending: number; refined: number; stillUnavailable: number; durationMs: number }> {
    const batch = opts.batch ?? 50;
    const maxAiCalls = opts.maxAiCalls ?? 15;
    const startedAt = Date.now();
    const aiDeadline = startedAt + (opts.aiTimeBudgetMs ?? 120_000);
    const result = { pending: 0, refined: 0, stillUnavailable: 0, durationMs: 0 };
    if (!this.ai) return { ...result, durationMs: Date.now() - startedAt };

    for (const ctx of await this.userContexts(opts.userIds)) {
      const pending = await this.db
        .select({ job: jobs, matchId: jobMatches.id })
        .from(jobMatches)
        .innerJoin(jobs, eq(jobs.id, jobMatches.jobId))
        .where(
          and(
            eq(jobMatches.userId, ctx.userId),
            eq(jobMatches.profileVersion, ctx.profileVersion),
            isNull(jobMatches.aiProvider),
            gte(jobMatches.overallScore, AI_PREFILTER_MIN),
          ),
        )
        .orderBy(desc(jobMatches.overallScore))
        .limit(batch);
      result.pending += pending.length;

      for (const row of pending) {
        if (result.refined >= maxAiCalls || Date.now() >= aiDeadline) break;
        const refined = await this.refineWithAi(ctx, row.job);
        if (refined.status !== 'OK') {
          result.stillUnavailable++;
          // The provider is down or out of budget; the rest of the batch would fail the same way.
          break;
        }
        const s = refined.score;
        await this.db
          .update(jobMatches)
          .set({
            overallScore: s.overall,
            skillScore: s.skillScore,
            roleScore: s.roleScore,
            priority: s.priority,
            matchedSkills: s.matchedSkills,
            missingSkills: s.missingSkills,
            explanation: s.explanation,
            aiProvider: this.ai.primaryProvider.name,
            aiModel: this.ai.primaryProvider.model,
            promptVersion: 'match.v1',
            computedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(jobMatches.id, row.matchId));
        result.refined++;
      }
    }

    result.durationMs = Date.now() - startedAt;
    return result;
  }

  private async refineWithAi(
    ctx: UserContext,
    job: typeof jobs.$inferSelect,
  ): Promise<{ status: 'OK'; score: MatchScore } | { status: 'UNAVAILABLE' | 'SKIPPED' }> {
    if (!this.ai) return { status: 'UNAVAILABLE' };

    // Requirements are extracted once per job and cached by content hash inside AIService.
    const reqRes = await this.ai.run(
      buildJobRequirementsRequest({
        title: job.title,
        description: job.description,
        requirements: job.requirements,
      }),
    );
    if (reqRes.status !== 'OK') return { status: 'UNAVAILABLE' };
    const requirements: JobRequirements = reqRes.data;

    // Re-score deterministically with the extracted requirements: better baseline, still rules-only.
    const withRequirements = scoreMatch(ctx.profile, {
      ...toMatchJob(job),
      mustHaveSkills: requirements.mustHaveSkills,
      niceToHaveSkills: requirements.niceToHaveSkills,
    });

    const matchRes = await this.ai.run(
      buildMatchRequest({
        candidate: {
          skills: ctx.profile.skills,
          preferredRoles: ctx.preferredRoleTitles,
          experienceLevel: ctx.experienceLevel,
          summary: ctx.summary,
        },
        job: {
          title: job.title,
          roleFamily: job.roleFamily,
          mustHaveSkills: requirements.mustHaveSkills,
          niceToHaveSkills: requirements.niceToHaveSkills,
          responsibilities: requirements.responsibilities,
        },
        baseline: {
          skillScore: withRequirements.skillScore,
          roleScore: withRequirements.roleScore,
        },
      }),
    );
    if (matchRes.status !== 'OK') return { status: 'OK', score: withRequirements }; // requirements alone still improved it
    return { status: 'OK', score: applyAiRefinement(withRequirements, matchRes.data) };
  }

  private async persist(rows: (typeof jobMatches.$inferInsert)[], jobIds: string[]): Promise<void> {
    if (rows.length === 0) return;
    const CHUNK = 200;
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        await tx
          .insert(jobMatches)
          .values(chunk)
          .onConflictDoUpdate({
            target: [jobMatches.jobId, jobMatches.userId, jobMatches.profileVersion],
            set: {
              overallScore: sql`excluded.overall_score`,
              skillScore: sql`excluded.skill_score`,
              roleScore: sql`excluded.role_score`,
              experienceScore: sql`excluded.experience_score`,
              locationScore: sql`excluded.location_score`,
              priority: sql`excluded.priority`,
              matchedSkills: sql`excluded.matched_skills`,
              missingSkills: sql`excluded.missing_skills`,
              explanation: sql`excluded.explanation`,
              computedAt: new Date(),
              updatedAt: new Date(),
            },
          });
      }
      // VALID → MATCHED; jobs awaiting review keep their status until the user decides.
      await tx
        .update(jobs)
        .set({ status: 'MATCHED', matchedAt: new Date(), updatedAt: new Date() })
        .where(and(inArray(jobs.id, jobIds), eq(jobs.status, 'VALID')));
      await tx.insert(jobEvents).values(
        rows.map((r) => ({
          jobId: r.jobId,
          type: 'MATCHED',
          detail: {
            userId: r.userId,
            score: r.overallScore,
            priority: r.priority,
            profileVersion: r.profileVersion,
          },
        })),
      );
    });
  }

  /** Every onboarded user with a confirmed profile (single-user today, correct for many). */
  private async userContexts(userIds?: string[]): Promise<UserContext[]> {
    if (userIds?.length === 0) return [];
    const rows = await this.db
      .select({
        userId: users.id,
        profileVersion: users.profileVersion,
        profileId: profiles.id,
        experienceLevel: profiles.experienceLevel,
        summary: profiles.summary,
        locations: preferences.locations,
        remotePreference: preferences.remotePreference,
        employmentTypes: preferences.employmentTypes,
        categories: preferences.categories,
        fresherOnly: preferences.fresherOnly,
        graduationYear: preferences.graduationYear,
      })
      .from(users)
      .innerJoin(profiles, eq(profiles.userId, users.id))
      .innerJoin(preferences, eq(preferences.userId, users.id))
      .where(userIds ? inArray(users.id, userIds) : undefined);

    const contexts: UserContext[] = [];
    for (const r of rows) {
      const skillRows = await this.db
        .select({ name: skills.name })
        .from(profileSkills)
        .innerJoin(skills, eq(skills.id, profileSkills.skillId))
        .where(eq(profileSkills.profileId, r.profileId));
      const roleRows = await this.db
        .select({
          roleFamily: preferredRoles.roleFamily,
          normalizedTitle: preferredRoles.normalizedTitle,
          title: preferredRoles.title,
          tier: preferredRoles.tier,
          enabled: preferredRoles.enabled,
        })
        .from(preferredRoles)
        .where(eq(preferredRoles.userId, r.userId));

      contexts.push({
        userId: r.userId,
        profileVersion: r.profileVersion,
        experienceLevel: r.experienceLevel,
        summary: r.summary,
        preferredRoleTitles: roleRows.filter((x) => x.enabled).map((x) => x.title),
        profile: {
          skills: skillRows.map((s) => s.name),
          roles: roleRows.map((x) => ({
            roleFamily: x.roleFamily,
            normalizedTitle: x.normalizedTitle,
            tier: x.tier,
            enabled: x.enabled,
          })),
          locations: r.locations,
          remotePreference: r.remotePreference,
          employmentTypes: r.employmentTypes,
          categories: r.categories,
          fresherOnly: r.fresherOnly,
          graduationYear: r.graduationYear,
        },
      });
    }
    return contexts;
  }
}

function toMatchJob(job: typeof jobs.$inferSelect): MatchJob {
  return {
    title: job.title,
    roleFamily: job.roleFamily,
    category: job.category,
    skills: job.skills,
    experienceLevel: job.experienceLevel,
    fresherEligible: job.fresherEligible,
    employmentType: job.employmentType,
    locationCity: job.locationCity,
    locationCountry: job.locationCountry,
    isRemote: job.isRemote,
  };
}
