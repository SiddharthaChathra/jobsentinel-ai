import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import {
  buildCategoryClassifyRequest,
  buildFresherClassifyRequest,
  categoryVerdict,
  type AIService,
} from '@jobsentinel/ai';
import type { ExperienceLevel, JobCategory, PostingType } from '@jobsentinel/types';
import {
  classifyCategory,
  classifyExperience,
  classifyPostingType,
  placeholderMatch,
  isIndiaLocation,
  extractBatchYears,
  isBatchEligible,
  isFresherRole,
  MAX_FRESHER_MIN_YEARS,
  type ExperienceEvidence,
} from '@jobsentinel/validation';
import type { Env } from '@jobsentinel/config';
import { AI_SERVICE } from '../common/ai/ai.module';
import { ENV } from '../common/config/config.module';
import { DB, type Db } from '../common/db/db.module';
import { jobEvents, jobs, preferences } from '../common/db/schema';

export interface ClassifyResult {
  processed: number;
  classified: number;
  filteredOut: number;
  aiUsed: number;
  aiUnavailable: number;
  /** Unknown-experience jobs left DISCOVERED to wait for an AI verdict next run (D96). */
  deferred: number;
  /** General-application / talent-pool postings, set aside before any other gate (D117). */
  placeholders: number;
}

type JobRow = typeof jobs.$inferSelect;

interface JobDecision {
  jobId: string;
  /**
   * NEEDS_REVIEW: held — category or experience unknown after the AI was asked or could not
   * answer (D105, D110). Persisted as CLASSIFIED with `hold_reason`, so validation (scam, URL,
   * company) still runs; a VALID verdict then leaves the job NEEDS_REVIEW, never alertable.
   */
  /** PLACEHOLDER: not a job — a general application or talent pool (D117). */
  status: 'CLASSIFIED' | 'FILTERED_OUT' | 'DEFERRED' | 'NEEDS_REVIEW' | 'PLACEHOLDER';
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
  /** AI calls this decision made (category and/or experience). */
  aiCalls: number;
  aiUnavailable: boolean;
  /** Set when the AI was asked for the category on this run (D105). */
  categoryAsked: boolean;
  postingType: PostingType;
  reason: string;
}

/** Categories any user monitors; a job outside every user's list is FILTERED_OUT but kept. */
interface MonitoringPrefs {
  categories: Set<JobCategory>;
  graduationYears: Set<number | null>;
}

const AI_CONFIDENCE_FLOOR = 0.6;

/** Reason for a job held because its category could not be placed (A, D105). */
export const CATEGORY_HELD_REASON = 'category unknown';

/** Reason prefix for a job filtered only because its experience could not be placed (D96). */
export const UNKNOWN_EXPERIENCE_REASON = 'experience unknown';

/**
 * Runs an unknown-experience job may wait for an AI verdict before it is filtered without one.
 * The AI gets a time box per batch (~13 calls at the free tier's pacing), so most ambiguous jobs
 * in a large batch are not reached the first time; filtering them unasked would drop fresher
 * roles that merely do not state experience. Shares `stage_attempts`, which stops at 5.
 */
const MAX_AI_WAITS = 4;

function notFresherReason(
  level: ExperienceLevel,
  minYears: number | null,
  verdictMissing: boolean,
): string {
  if (minYears !== null && minYears > MAX_FRESHER_MIN_YEARS) return `asks for ${minYears}+ years`;
  if (level === 'EXPERIENCED') return 'experienced role';
  return verdictMissing
    ? `${UNKNOWN_EXPERIENCE_REASON} (no AI verdict)`
    : UNKNOWN_EXPERIENCE_REASON;
}

/** A held job goes on to validation like any other; `hold_reason` carries the hold (D110). */
function persistedStatus(d: JobDecision): 'CLASSIFIED' | 'FILTERED_OUT' | 'PLACEHOLDER' {
  if (d.status === 'FILTERED_OUT' || d.status === 'PLACEHOLDER') return d.status;
  return 'CLASSIFIED';
}

/** Statuses a job reaches only after passing classification, and before it is closed. */
const REFILTERABLE = [
  'VALIDATING',
  'VALID',
  'SUSPICIOUS',
  'NEEDS_REVIEW',
  'MATCHED',
  'AI_PENDING',
  'NOTIFY_PENDING',
  'NOTIFIED',
] as const;

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
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * `jobIds` restricts the run to specific jobs. The worker never passes it; an integration test
   * must, for the same reason `validatePending` must (D77): these suites share one live database,
   * so an unscoped `batch: 500` sweeps up whatever real postings happen to be DISCOVERED and the
   * assertions then depend on what the scanner ingested minutes earlier. That made the
   * classification suite pass or fail depending on the hour (D80).
   */
  async classifyPending(
    opts: { batch?: number; maxAiCalls?: number; aiTimeBudgetMs?: number; jobIds?: string[] } = {},
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
      deferred: 0,
      placeholders: 0,
    };

    const pending = await this.db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.status, 'DISCOVERED'),
          sql`${jobs.stageAttempts} < 5`,
          ...(opts.jobIds ? [inArray(jobs.id, opts.jobIds)] : []),
        ),
      )
      .orderBy(jobs.firstSeenAt)
      .limit(batch);
    if (pending.length === 0) return result;

    // Decisions are computed first (pure + optional AI), then written in two statements per batch:
    // per-job transactions cost ~0.4 s each over the pooler, which made a full re-classify unusable.
    const decisions: JobDecision[] = [];
    const categoryAskedIds: string[] = [];
    const deferredIds: string[] = [];
    for (const job of pending) {
      result.processed++;
      try {
        const decision = await this.decide(
          job,
          prefs,
          result.aiUsed < maxAiCalls && Date.now() < aiDeadline,
        );
        result.aiUsed += decision.aiCalls;
        if (decision.categoryAsked) categoryAskedIds.push(decision.jobId);
        if (decision.aiUnavailable) result.aiUnavailable++;
        if (decision.status === 'DEFERRED') {
          result.deferred++;
          deferredIds.push(job.id);
          continue;
        }
        if (decision.status === 'FILTERED_OUT') result.filteredOut++;
        else if (decision.status === 'PLACEHOLDER') result.placeholders++;
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
    if (categoryAskedIds.length > 0) {
      // Recorded even for a deferred job, so its category is never asked again (D105).
      await this.db
        .update(jobs)
        .set({ categoryAiAt: new Date() })
        .where(inArray(jobs.id, categoryAskedIds));
    }
    if (deferredIds.length > 0) {
      // Still DISCOVERED, so the next run picks them up; the attempt count bounds the waiting.
      await this.db
        .update(jobs)
        .set({
          stageAttempts: sql`${jobs.stageAttempts} + 1`,
          stageError: 'waiting for an AI verdict on experience',
        })
        .where(inArray(jobs.id, deferredIds));
    }
    return result;
  }

  private async decide(
    job: JobRow,
    prefs: MonitoringPrefs,
    aiAllowed: boolean,
  ): Promise<JobDecision> {
    const category = classifyCategory({ title: job.title, skills: job.skills });
    // Not a job at all (D117): decided first, from the title alone, so no AI call, validation,
    // match or alert is ever spent on it. The row is kept so a re-scan finds it known.
    const placeholder = this.env.PLACEHOLDER_FILTER_ENABLED ? placeholderMatch(job.title) : null;
    if (placeholder) {
      return {
        jobId: job.id,
        status: 'PLACEHOLDER',
        category: category.category,
        roleFamily: category.roleFamily,
        level: 'UNKNOWN',
        fresherEligible: null,
        confidence: 1,
        evidence: [],
        minYears: job.experienceMinYears,
        maxYears: job.experienceMaxYears,
        experienceText: job.experienceText,
        usedAi: false,
        aiCalls: 0,
        aiUnavailable: false,
        categoryAsked: false,
        postingType: 'REGULAR',
        reason: `placeholder posting ("${placeholder}")`,
      };
    }
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

    // Location gate: India, or any remote role (D102). On-site jobs abroad are filtered: a posting
    // whose country never resolved is foreign in practice — measured across 3,394 live jobs, 530 of
    // the 531 such postings were (D73). Remote roles are kept whatever country they name, at the
    // owner's request: "Remote · United States" may still need local work rights, so the country
    // stays visible on the card rather than deciding for the user. FILTERED_OUT
    // is recoverable by a preferences change; narrowing to the user's preferred places is the jobs
    // query's job, where it can be lifted per request (D62).
    const inIndia = isIndiaLocation({
      text: job.locationText,
      city: job.locationCity,
      country: job.locationCountry,
      isRemote: job.isRemote,
    });
    const indiaOk = inIndia || job.isRemote;

    // Every batch the posting names, title included ("Freshers 2026/27"): eligible only if the
    // user's year is among them (D107). "2025/2026/2027" includes a 2027 graduate; "2025 only" not.
    const batchYears = extractBatchYears(`${job.title}
${job.description}`);
    const jobBatchYear = batchYears?.join('/') ?? null;
    const isBatchCompatible = Array.from(prefs.graduationYears).some((gy) =>
      isBatchEligible(batchYears, gy),
    );

    // Category (A, D105). The rules could not place it: ask the AI for the CATEGORY only — once
    // per canonical job, lowest AI priority — and only for a job the deterministic gates have not
    // already ruled out (location, batch, a stated experience requirement). The answer can make a
    // job eligible for the category gate; it can never override the gates above or below.
    let resolvedCategory: JobCategory = category.category;
    let categoryHeld = false;
    let categoryPending = false;
    let categoryAsked = false;
    let aiCalls = 0;
    const statedNotFresher =
      rules.level === 'EXPERIENCED' || (rules.minYears !== null && rules.minYears > 0);
    if (category.category === 'UNKNOWN' && indiaOk && isBatchCompatible && !statedNotFresher) {
      if (job.categoryAiAt) {
        // Asked before: reuse the stored verdict, never ask again.
        if (job.category !== 'UNKNOWN') resolvedCategory = job.category;
        else categoryHeld = true;
      } else if (!aiAllowed || !this.ai) {
        categoryPending = true;
        aiUnavailable = !this.ai;
      } else {
        const res = await this.ai.run(
          buildCategoryClassifyRequest({
            jobId: job.id,
            title: job.title,
            description: job.description,
          }),
        );
        if (res.status === 'OK') {
          categoryAsked = true;
          if (!res.cached) aiCalls++;
          const verdict = categoryVerdict(res.data);
          if (verdict.placed) resolvedCategory = verdict.category;
          else categoryHeld = true;
        } else {
          categoryPending = true;
          aiUnavailable = true;
        }
      }
    }

    // Category gate: never spend an experience AI call on a job nobody monitors.
    const monitored = prefs.categories.has(resolvedCategory);
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
          if (!res.cached) aiCalls++;
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

    if (!isBatchCompatible) {
      // Not `level = 'EXPERIENCED'`: a "2025 batch only" posting is a fresher role for a different
      // batch, and relabelling it experienced would make the detail page and the alert state
      // something untrue about the job. The mismatch filters it on its own, below.
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

    // JobSentinel lists only roles that accept zero experience, for every account (D96). This replaced
    // the per-user "fresher only" / "include unknown experience" switches: UNKNOWN used to be
    // listed by default, which is how generic "Backend Engineer" postings reached the list.
    // UNKNOWN still reaches the AI above when monitored; only its verdict can make it listable.
    const minYears =
      rules.minYears ?? (job.experienceMinYears ? Number(job.experienceMinYears) : null);
    const notFresher = !isFresherRole({ level, minYears });
    // No stated years and no level: the posting simply does not say (D110).
    const experienceUnknown = notFresher && minYears === null && level === 'UNKNOWN';
    const batchExcluded = !isBatchCompatible;
    // Only the AI can place an ambiguous job; until it has answered, the job waits (bounded).
    const verdictMissing = monitored && rules.needsAi && !usedAi && level === 'UNKNOWN';
    // Gates in a fixed order; the first that fails decides. Deterministic ones first (D105).
    let status: JobDecision['status'];
    let reason: string;
    if (!indiaOk) {
      status = 'FILTERED_OUT';
      reason = `location outside India (${job.locationCountry ?? 'unknown'})`;
    } else if (batchExcluded) {
      status = 'FILTERED_OUT';
      reason = `targets the ${jobBatchYear} batch`;
    } else if (statedNotFresher) {
      status = 'FILTERED_OUT';
      reason = notFresherReason(level, minYears, false);
    } else if (categoryPending) {
      // The category AI has not answered yet (budget, time box, outage): wait, bounded.
      status = job.stageAttempts < MAX_AI_WAITS ? 'DEFERRED' : 'NEEDS_REVIEW';
      reason = `${CATEGORY_HELD_REASON} (no AI verdict)`;
    } else if (categoryHeld) {
      // Unsure or "unknown": held for review — if it would otherwise be a fresher role, or its
      // experience is unknown too (D110: unknown is held, not filtered).
      status = notFresher && !experienceUnknown ? 'FILTERED_OUT' : 'NEEDS_REVIEW';
      reason = !notFresher
        ? CATEGORY_HELD_REASON
        : experienceUnknown
          ? `${CATEGORY_HELD_REASON}; ${notFresherReason(level, minYears, verdictMissing)}`
          : notFresherReason(level, minYears, verdictMissing);
    } else if (!monitored) {
      status = 'FILTERED_OUT';
      reason = 'category not monitored';
    } else if (notFresher) {
      // Experience not stated and not placed (by the rules, or by the AI after its bounded
      // waits): held for the user to judge, never filtered unseen (owner's R2 decision, D110).
      // A stated requirement or an EXPERIENCED verdict is still filtered.
      status =
        verdictMissing && job.stageAttempts < MAX_AI_WAITS
          ? 'DEFERRED'
          : experienceUnknown
            ? 'NEEDS_REVIEW'
            : 'FILTERED_OUT';
      reason = notFresherReason(level, minYears, verdictMissing);
    } else {
      status = 'CLASSIFIED';
      reason =
        category.category === resolvedCategory
          ? category.reason
          : `category from AI: ${resolvedCategory}`;
    }

    return {
      jobId: job.id,
      status,
      category: resolvedCategory,
      roleFamily: category.roleFamily,
      level,
      fresherEligible,
      confidence,
      evidence,
      minYears: rules.minYears === null ? job.experienceMinYears : String(rules.minYears),
      maxYears: rules.maxYears === null ? job.experienceMaxYears : String(rules.maxYears),
      experienceText: rules.experienceText ?? job.experienceText,
      usedAi: usedAi || categoryAsked,
      aiCalls,
      aiUnavailable,
      categoryAsked,
      postingType: classifyPostingType({ title: job.title, description: job.description }),
      reason,
    };
  }

  /**
   * Re-applies today's gates to jobs that already passed classification (D86).
   *
   * Classification runs once, so a job admitted before a gate existed (India-only, D73; the
   * stated-years rule, D59; batch years) stays listed, scored and alertable forever. This runs the
   * same `decide()` with the same preferences, but rules-only: without the AI a job can only come
   * out *as or more* visible than the live pipeline would leave it, so this can filter a job but
   * never un-filter one. Jobs anyone saved or is tracking past "viewed" are left alone — a
   * reclassification must not take a job out from under the user.
   *
   * `jobIds` scopes the run; an integration test must pass it (D77).
   */
  async refilterListed(
    opts: { apply: boolean; jobIds?: string[]; batch?: number } = { apply: false },
  ): Promise<{
    checked: number;
    filtered: { id: string; title: string; reason: string }[];
    requeued: { id: string; title: string }[];
  }> {
    const prefs = await this.monitoringPrefs();
    const batch = opts.batch ?? 200;
    const filtered: { id: string; title: string; reason: string }[] = [];
    const requeued: { id: string; title: string }[] = [];
    let checked = 0;
    let after = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const page = await this.db
        .select()
        .from(jobs)
        .where(
          and(
            inArray(jobs.status, [...REFILTERABLE]),
            sql`${jobs.id} > ${after}::uuid`,
            sql`not exists (select 1 from saved_jobs s where s.job_id = ${jobs.id})`,
            sql`not exists (select 1 from applications a where a.job_id = ${jobs.id} and a.status <> 'VIEWED')`,
            ...(opts.jobIds ? [inArray(jobs.id, opts.jobIds)] : []),
          ),
        )
        .orderBy(jobs.id)
        .limit(batch);
      if (page.length === 0) break;
      after = page[page.length - 1]!.id;
      checked += page.length;

      const decisions: JobDecision[] = [];
      for (const job of page) {
        const decision = await this.decide(job, prefs, false);
        if (decision.status === 'CLASSIFIED') continue;
        // Already held, and still would be: nothing to re-filter (D110).
        if (decision.status === 'NEEDS_REVIEW' && job.status === 'NEEDS_REVIEW') continue;
        if (
          decision.status === 'DEFERRED' ||
          decision.reason.startsWith(UNKNOWN_EXPERIENCE_REASON)
        ) {
          // The rules alone cannot place it. A stored AI verdict that did is kept; otherwise the
          // job goes back to classification, where the AI decides — not filtered unasked (D96).
          const stored = job.experienceMinYears ? Number(job.experienceMinYears) : null;
          if (isFresherRole({ level: job.experienceLevel, minYears: stored })) continue;
          requeued.push({ id: job.id, title: job.title });
          continue;
        }
        decisions.push({ ...decision, reason: `re-filtered: ${decision.reason}` });
        filtered.push({ id: job.id, title: job.title, reason: decision.reason });
      }
      if (opts.apply && decisions.length > 0) await this.persist(decisions);
    }
    if (opts.apply) {
      const ids = requeued.map((r) => r.id);
      for (let i = 0; i < ids.length; i += 50) {
        await this.db
          .update(jobs)
          .set({ status: 'DISCOVERED', stageAttempts: 0, stageError: null })
          .where(inArray(jobs.id, ids.slice(i, i + 50)));
      }
    }
    return { checked, filtered, requeued };
  }

  /** Two statements per batch (one UPDATE ... FROM VALUES, one bulk event insert), in one transaction. */
  private async persist(decisions: JobDecision[]): Promise<void> {
    const rows = decisions.map(
      (d) =>
        sql`(${d.jobId}::uuid, ${d.category}::job_category, ${d.roleFamily}, ${d.level}::experience_level, ${d.fresherEligible}::boolean, ${d.confidence.toFixed(2)}::numeric, ${JSON.stringify(d.evidence)}::jsonb, ${d.minYears}::numeric, ${d.maxYears}::numeric, ${d.experienceText}::text, ${persistedStatus(d)}::job_status, ${d.status === 'NEEDS_REVIEW' ? d.reason : null}::text, ${d.postingType}::posting_type)`,
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
          hold_reason = v.hold_reason,
          posting_type = v.posting_type,
          stage_error = null,
          updated_at = now()
        from (values ${sql.join(rows, sql`, `)}) as v(id, category, role_family, level, fresher_eligible, confidence, evidence, min_years, max_years, experience_text, status, hold_reason, posting_type)
        where j.id = v.id`);
      await tx.insert(jobEvents).values(
        decisions.map((d) => ({
          jobId: d.jobId,
          type:
            d.status === 'FILTERED_OUT' || d.status === 'PLACEHOLDER'
              ? d.status
              : d.status === 'NEEDS_REVIEW'
                ? 'HELD'
                : 'CLASSIFIED',
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
        // `null` means "no batch constraint", which is what an absent profile actually tells us.
        // Substituting a literal year here would invent a filter the user never asked for, and
        // would silently become the wrong year every August.
        graduationYears: new Set<number | null>([null]),
      };
    }
    const categories = new Set<JobCategory>();
    const graduationYears = new Set<number | null>();
    for (const r of rows) {
      for (const c of r.categories) categories.add(c);
      graduationYears.add(r.graduationYear); // null stays null — see above
    }
    return {
      categories,
      graduationYears,
    };
  }

  /** Re-classify jobs after a preferences change (docs 09 §4): FILTERED_OUT ⇄ CLASSIFIED. */
  /**
   * Global on purpose — a preferences change has to re-evaluate every job, so the worker and
   * `pnpm classify --requeue` pass no `jobIds`. A test must, because "the first `limit` rows of a
   * shared table" is not a set it can reason about: once the project held a few thousand filtered
   * postings, a `limit` of 1 000 stopped reaching the suite's own fixtures and the assertion began
   * failing on data volume rather than on behaviour (D80).
   */
  async requeueFiltered(limit = 500, jobIds?: string[]): Promise<number> {
    const rows = await this.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          or(eq(jobs.status, 'FILTERED_OUT'), eq(jobs.status, 'CLASSIFIED')),
          ...(jobIds ? [inArray(jobs.id, jobIds)] : []),
        ),
      )
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
