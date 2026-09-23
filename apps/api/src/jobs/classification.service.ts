import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { buildFresherClassifyRequest, type AIService } from '@jobsentinel/ai';
import type { ExperienceLevel, JobCategory } from '@jobsentinel/types';
import {
  classifyCategory,
  classifyExperience,
  isIndiaLocation,
  extractJobBatchYear,
  isBatchYearCompatible,
  type ExperienceEvidence,
} from '@jobsentinel/validation';
import { AI_SERVICE } from '../common/ai/ai.module';
import { DB, type Db } from '../common/db/db.module';
import { jobEvents, jobs, preferences } from '../common/db/schema';

export interface ClassifyResult {
  processed: number;
  classified: number;
  filteredOut: number;
  aiUsed: number;
  aiUnavailable: number;
}

type JobRow = typeof jobs.$inferSelect;

interface JobDecision {
  jobId: string;
  status: 'CLASSIFIED' | 'FILTERED_OUT';
  category: JobCategory;
  roleFamily: string;
  level: ExperienceLevel;
  fresherEligible: boolean | null;
  confidence: number;
  evidence: ExperienceEvidence[];
  minYears: string | null;
  maxYears: string | null;
  experienceText: string | null;
  usedAi: boolean;
  aiUnavailable: boolean;
  reason: string;
}

/** Categories any user monitors; a job outside every user's list is FILTERED_OUT but kept. */
interface MonitoringPrefs {
  categories: Set<JobCategory>;
  fresherOnlyForAll: boolean;
  includeUnknownExperience: boolean;
  graduationYears: Set<number | null>;
}

const AI_CONFIDENCE_FLOOR = 0.6;

/**
 * Pipeline stage DISCOVERED → CLASSIFIED | FILTERED_OUT (docs 09 §4, spec §7).
 * Rules decide first; the AI is asked only for genuinely ambiguous jobs that survive the
 * category/preference gate, and it can never make a job *less* visible than UNKNOWN.
 */
@Injectable()
export class ClassificationService {
  private readonly logger = new Logger(ClassificationService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AI_SERVICE) private readonly ai: AIService | null,
  ) {}

  async classifyPending(
    opts: { batch?: number; maxAiCalls?: number; aiTimeBudgetMs?: number } = {},
  ): Promise<ClassifyResult> {
    const batch = opts.batch ?? 50;
    const maxAiCalls = opts.maxAiCalls ?? 25;
    // Free-tier providers can be very slow (Gemini was measured at 60 s+ under load), so the
    // AI portion of a batch is also time-boxed: past the budget, the rules verdict stands.
    const aiDeadline = Date.now() + (opts.aiTimeBudgetMs ?? 60_000);
    const prefs = await this.monitoringPrefs();
    const result: ClassifyResult = {
      processed: 0,
      classified: 0,
      filteredOut: 0,
      aiUsed: 0,
      aiUnavailable: 0,
    };

    const pending = await this.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, 'DISCOVERED'), sql`${jobs.stageAttempts} < 5`))
      .orderBy(jobs.firstSeenAt)
      .limit(batch);
    if (pending.length === 0) return result;

    // Decisions are computed first (pure + optional AI), then written in two statements per batch:
    // per-job transactions cost ~0.4 s each over the pooler, which made a full re-classify unusable.
    const decisions: JobDecision[] = [];
    for (const job of pending) {
      result.processed++;
      try {
        const decision = await this.decide(
          job,
          prefs,
          result.aiUsed < maxAiCalls && Date.now() < aiDeadline,
        );
        if (decision.usedAi) result.aiUsed++;
        if (decision.aiUnavailable) result.aiUnavailable++;
        if (decision.status === 'FILTERED_OUT') result.filteredOut++;
        else result.classified++;
        decisions.push(decision);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`classify ${job.id} failed: ${message}`);
        await this.db
          .update(jobs)
          .set({ stageAttempts: sql`${jobs.stageAttempts} + 1`, stageError: message.slice(0, 500) })
          .where(eq(jobs.id, job.id));
      }
    }
    if (decisions.length > 0) await this.persist(decisions);
    return result;
  }

  private async decide(
    job: JobRow,
    prefs: MonitoringPrefs,
    aiAllowed: boolean,
  ): Promise<JobDecision> {
    const category = classifyCategory({ title: job.title, skills: job.skills });
    const rules = classifyExperience({
      title: job.title,
      experienceText: job.experienceText,
      description: job.description,
      employmentType: job.employmentType,
    });

    let level = rules.level;
    let fresherEligible = rules.fresherEligible;
    let confidence = rules.confidence;
    let evidence: ExperienceEvidence[] = rules.evidence;
    let usedAi = false;
    let aiUnavailable = false;

    // Category gate first: never spend an AI call on a job nobody monitors.
    const monitored = prefs.categories.has(category.category);
    if (monitored && rules.needsAi && aiAllowed) {
      if (!this.ai) {
        aiUnavailable = true;
      } else {
        const res = await this.ai.run(
          buildFresherClassifyRequest({
            title: job.title,
            experienceText: job.experienceText,
            description: job.description,
            ruleEvidence: rules.evidence.map((e) => `${e.code}: ${e.detail}`),
          }),
        );
        if (res.status === 'OK') {
          usedAi = true;
          // A hesitant model never overrides the rules (docs 09 §1: AI is a signal, not a judge).
          if (res.data.confidence >= AI_CONFIDENCE_FLOOR) {
            level = res.data.level;
            fresherEligible = res.data.fresherEligible;
            confidence = res.data.confidence;
            evidence = [
              ...rules.evidence,
              ...res.data.evidence.map((q) => ({
                code: 'AI',
                detail: q,
                weight: res.data.fresherEligible ? ('POSITIVE' as const) : ('NEGATIVE' as const),
              })),
            ];
          }
        } else {
          aiUnavailable = true;
          this.logger.debug(`AI classify unavailable for ${job.id}: ${res.status}`);
        }
      }
    }

    // Location gate. This one is permanent — a FILTERED_OUT job is never validated, matched or
    // alerted — so it only drops postings pinned to a known office somewhere else. India, remote
    // roles and postings that state no location all pass: "unknown" is not "no" (docs 08), and
    // 832 remote plus 528 unlocated jobs would otherwise be destroyed outright. Narrowing the
    // list to the user's preferred places is the jobs query's job, where it is reversible (D67).
    const inIndia = isIndiaLocation({
      text: job.locationText,
      city: job.locationCity,
      country: job.locationCountry,
      isRemote: job.isRemote,
    });
    const indiaOk = inIndia || job.isRemote || job.locationCountry === null;

    const jobBatchYear = extractJobBatchYear(job.description);
    const isBatchCompatible = Array.from(prefs.graduationYears).some((gy) =>
      isBatchYearCompatible(jobBatchYear, gy),
    );

    if (!isBatchCompatible) {
      fresherEligible = false;
      const profileYears = Array.from(prefs.graduationYears)
        .filter((y) => y !== null)
        .join(', ');
      evidence.push({
        code: 'BATCH_YEAR_MISMATCH',
        detail: `Job targets ${jobBatchYear} batch, profile is ${profileYears}`,
        weight: 'NEGATIVE',
      });
    }

    // Filtered out only when nobody monitors the category, or it is definitely too senior.
    const tooSenior = prefs.fresherOnlyForAll && level === 'EXPERIENCED';
    const unknownExcluded = !prefs.includeUnknownExperience && level === 'UNKNOWN';
    const status = !indiaOk
      ? 'FILTERED_OUT'
      : !monitored || tooSenior || unknownExcluded
        ? 'FILTERED_OUT'
        : 'CLASSIFIED';

    return {
      jobId: job.id,
      status,
      category: category.category,
      roleFamily: category.roleFamily,
      level,
      fresherEligible,
      confidence,
      evidence,
      minYears: rules.minYears === null ? job.experienceMinYears : String(rules.minYears),
      maxYears: rules.maxYears === null ? job.experienceMaxYears : String(rules.maxYears),
      experienceText: rules.experienceText ?? job.experienceText,
      usedAi,
      aiUnavailable,
      reason: !indiaOk
        ? `location outside India (${job.locationCountry ?? 'unknown'})`
        : !monitored
          ? 'category not monitored'
          : tooSenior
            ? 'experienced role, fresher-only mode'
            : unknownExcluded
              ? 'unknown experience excluded'
              : category.reason,
    };
  }

  /** Two statements per batch (one UPDATE ... FROM VALUES, one bulk event insert), in one transaction. */
  private async persist(decisions: JobDecision[]): Promise<void> {
    const rows = decisions.map(
      (d) =>
        sql`(${d.jobId}::uuid, ${d.category}::job_category, ${d.roleFamily}, ${d.level}::experience_level, ${d.fresherEligible}::boolean, ${d.confidence.toFixed(2)}::numeric, ${JSON.stringify(d.evidence)}::jsonb, ${d.minYears}::numeric, ${d.maxYears}::numeric, ${d.experienceText}::text, ${d.status}::job_status)`,
    );
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        update jobs j set
          category = v.category,
          role_family = v.role_family,
          experience_level = v.level,
          fresher_eligible = v.fresher_eligible,
          fresher_confidence = v.confidence,
          fresher_evidence = v.evidence,
          experience_min_years = v.min_years,
          experience_max_years = v.max_years,
          experience_text = v.experience_text,
          status = v.status,
          stage_error = null,
          updated_at = now()
        from (values ${sql.join(rows, sql`, `)}) as v(id, category, role_family, level, fresher_eligible, confidence, evidence, min_years, max_years, experience_text, status)
        where j.id = v.id`);
      await tx.insert(jobEvents).values(
        decisions.map((d) => ({
          jobId: d.jobId,
          type: d.status === 'FILTERED_OUT' ? 'FILTERED_OUT' : 'CLASSIFIED',
          detail: {
            category: d.category,
            level: d.level,
            fresherEligible: d.fresherEligible,
            confidence: d.confidence,
            usedAi: d.usedAi,
            reason: d.reason,
          },
        })),
      );
    });
  }

  /** Union of every user's monitored categories (single-user today, still correct for many). */
  private async monitoringPrefs(): Promise<MonitoringPrefs> {
    const rows = await this.db
      .select({
        categories: preferences.categories,
        fresherOnly: preferences.fresherOnly,
        includeUnknown: preferences.includeUnknownExperience,
        graduationYear: preferences.graduationYear,
      })
      .from(preferences);
    if (rows.length === 0) {
      // No profile yet (fresh install): keep everything engineering, decide later.
      return {
        categories: new Set<JobCategory>([
          'SOFTWARE',
          'IT_SUPPORT',
          'NETWORK',
          'CLOUD_DEVOPS',
          'DATA',
          'ELECTRICAL_ELECTRONICS',
          'MECHANICAL',
          'CIVIL',
          'OTHER_ENGINEERING',
        ]),
        fresherOnlyForAll: false,
        includeUnknownExperience: true,
        graduationYears: new Set<number | null>([null]),
      };
    }
    const categories = new Set<JobCategory>();
    const graduationYears = new Set<number | null>();
    for (const r of rows) {
      for (const c of r.categories) categories.add(c);
      graduationYears.add(r.graduationYear);
    }
    return {
      categories,
      fresherOnlyForAll: rows.every((r) => r.fresherOnly),
      includeUnknownExperience: rows.some((r) => r.includeUnknown),
      graduationYears,
    };
  }

  /** Re-classify jobs after a preferences change (docs 09 §4): FILTERED_OUT ⇄ CLASSIFIED. */
  async requeueFiltered(limit = 500): Promise<number> {
    const rows = await this.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(or(eq(jobs.status, 'FILTERED_OUT'), eq(jobs.status, 'CLASSIFIED')))
      .limit(limit);
    if (rows.length === 0) return 0;
    await this.db
      .update(jobs)
      .set({ status: 'DISCOVERED', stageAttempts: 0 })
      .where(
        inArray(
          jobs.id,
          rows.map((r) => r.id),
        ),
      );
    return rows.length;
  }
}
