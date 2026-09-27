import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { buildSuspicionRequest, type AIService } from '@jobsentinel/ai';
import type { JobStatus, ValidationStatus } from '@jobsentinel/types';
import {
  decideValidation,
  detectSuspiciousIndicators,
  domainRelationship,
  nextCheckDelayMs,
  type Decision,
  type Evidence,
  type SuspicionFlag,
} from '@jobsentinel/validation';
import { AI_SERVICE } from '../common/ai/ai.module';
import { DB, type Db } from '../common/db/db.module';
import { companies, jobEvents, jobValidation, jobs } from '../common/db/schema';
import { CompanyVerificationService } from './company-verification.service';
import { UrlProbeService, type UrlProbeResult } from './url-probe.service';

export interface ValidateResult {
  processed: number;
  byStatus: Record<string, number>;
  aiUsed: number;
  aiUnavailable: number;
  durationMs: number;
}

type JobRow = typeof jobs.$inferSelect;
type CompanyRow = typeof companies.$inferSelect;

/** AI is consulted only in this confidence band, or when a soft scam flag needs a second opinion. */
const AI_BAND = { min: 0.35, max: 0.65 };
const SOFT_FLAG_THRESHOLD = -0.25;

/**
 * Pipeline stage CLASSIFIED → VALID | SUSPICIOUS | NEEDS_REVIEW | EXPIRED | INVALID (docs 08).
 * Order: company → URL probe → availability → suspicion rules → (optional AI) → decision.
 * Rules and evidence decide; the AI can shift the score by at most ±0.2 and never alone.
 */
@Injectable()
export class ValidationOrchestrator {
  private readonly logger = new Logger(ValidationOrchestrator.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AI_SERVICE) private readonly ai: AIService | null,
    private readonly companyVerification: CompanyVerificationService,
    private readonly urlProbe: UrlProbeService,
  ) {}

  /** Validates jobs waiting in CLASSIFIED, plus any due for a re-check. */
  /**
   * `jobIds` restricts the run to specific jobs. The worker never passes it; an integration test
   * must, because this runs against the shared live database — eight unscoped `batch: 5` calls in
   * the e2e suite validated real postings with the fake HTTP client, writing its "unscripted
   * request" error into 256 production validation records and demoting them all to NEEDS_REVIEW
   * (D77). Same reasoning, and same fix, as `recheckDue`.
   */
  async validatePending(
    opts: { batch?: number; maxAiCalls?: number; timeBudgetMs?: number; jobIds?: string[] } = {},
  ): Promise<ValidateResult> {
    const batch = opts.batch ?? 20;
    const maxAiCalls = opts.maxAiCalls ?? 10;
    const startedAt = Date.now();
    const deadline = startedAt + (opts.timeBudgetMs ?? 120_000);
    const result: ValidateResult = {
      processed: 0,
      byStatus: {},
      aiUsed: 0,
      aiUnavailable: 0,
      durationMs: 0,
    };

    const pending = await this.db
      .select({ job: jobs, company: companies })
      .from(jobs)
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .where(
        and(
          eq(jobs.status, 'CLASSIFIED'),
          sql`${jobs.stageAttempts} < 5`,
          ...(opts.jobIds ? [inArray(jobs.id, opts.jobIds)] : []),
        ),
      )
      .orderBy(jobs.firstSeenAt)
      .limit(batch);

    for (const { job, company } of pending) {
      if (Date.now() > deadline) break;
      result.processed++;
      try {
        const decision = await this.validateOne(job, company, result.aiUsed < maxAiCalls);
        result.byStatus[decision.status] = (result.byStatus[decision.status] ?? 0) + 1;
        if (decision.usedAi) result.aiUsed++;
        if (decision.aiUnavailable) result.aiUnavailable++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`validate ${job.id} failed: ${message}`);
        await this.db
          .update(jobs)
          .set({ stageAttempts: sql`${jobs.stageAttempts} + 1`, stageError: message.slice(0, 500) })
          .where(eq(jobs.id, job.id));
      }
    }
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  /** Re-checks active jobs whose `next_check_at` is due: closure detection only (docs 07 §1.5). */
  /**
   * `jobIds` narrows the sweep to specific jobs — used by the ops script and by tests, which
   * otherwise compete with however many real jobs happen to be due (the batch would fill with
   * them and never reach the job under test).
   */
  async recheckDue(
    opts: { batch?: number; jobIds?: string[] } = {},
  ): Promise<{ checked: number; expired: number }> {
    const batch = opts.batch ?? 20;
    if (opts.jobIds?.length === 0) return { checked: 0, expired: 0 };
    const due = await this.db
      .select({ job: jobs, company: companies })
      .from(jobs)
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .where(
        and(
          inArray(jobs.status, ['VALID', 'MATCHED', 'NOTIFIED', 'NEEDS_REVIEW'] as JobStatus[]),
          sql`${jobs.nextCheckAt} is not null and ${jobs.nextCheckAt} <= now()`,
          ...(opts.jobIds ? [inArray(jobs.id, opts.jobIds)] : []),
        ),
      )
      .orderBy(jobs.nextCheckAt)
      .limit(batch);

    let expired = 0;
    for (const { job } of due) {
      const url = job.finalApplicationUrl ?? job.applicationUrl ?? job.sourceUrl;
      const probe = await this.urlProbe.probe(url);
      const stale = job.firstSeenAt.getTime() < Date.now() - 60 * 86_400_000;
      const closed =
        probe.closedMarkers.length > 0 ||
        probe.urlStatus === 'NOT_FOUND' ||
        probe.urlStatus === 'CLOSED';
      const checks = (job.stageAttempts ?? 0) + 1;

      if (closed || stale) {
        expired++;
        await this.db.transaction(async (tx) => {
          await tx
            .update(jobs)
            .set({
              status: 'EXPIRED',
              validationStatus: 'EXPIRED',
              closedAt: new Date(),
              lastCheckedAt: new Date(),
              nextCheckAt: null,
              updatedAt: new Date(),
            })
            .where(eq(jobs.id, job.id));
          await tx
            .update(jobValidation)
            .set({
              status: 'EXPIRED',
              jobActive: false,
              urlStatus: probe.urlStatus,
              httpStatus: probe.httpStatus,
              validatedAt: new Date(),
            })
            .where(eq(jobValidation.jobId, job.id));
          await tx.insert(jobEvents).values({
            jobId: job.id,
            type: 'EXPIRED',
            detail: {
              reason: closed
                ? (probe.closedMarkers[0]?.code ?? probe.urlStatus)
                : 'stale: older than 60 days',
              httpStatus: probe.httpStatus,
            },
          });
        });
      } else {
        await this.db
          .update(jobs)
          .set({
            lastCheckedAt: new Date(),
            nextCheckAt: new Date(Date.now() + nextCheckDelayMs(checks)),
            updatedAt: new Date(),
          })
          .where(eq(jobs.id, job.id));
        await this.db.insert(jobEvents).values({
          jobId: job.id,
          type: 'RECHECKED',
          detail: { urlStatus: probe.urlStatus, httpStatus: probe.httpStatus },
        });
      }
    }
    return { checked: due.length, expired };
  }

  /** Forces a fresh validation (dashboard "re-validate", or after the apply URL changed). */
  async revalidate(jobId: string): Promise<ValidationStatus> {
    const row = await this.db
      .select({ job: jobs, company: companies })
      .from(jobs)
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .where(eq(jobs.id, jobId))
      .limit(1);
    if (row.length === 0) throw new Error('job not found');
    const { job, company } = row[0]!;
    const outcome = await this.validateOne(job, company, true);
    return outcome.status;
  }

  private async validateOne(
    job: JobRow,
    company: CompanyRow,
    aiAllowed: boolean,
  ): Promise<{ status: ValidationStatus; usedAi: boolean; aiUnavailable: boolean }> {
    await this.db
      .update(jobs)
      .set({ status: 'VALIDATING', updatedAt: new Date() })
      .where(eq(jobs.id, job.id));

    // 1. Company
    const companyCheck = await this.companyVerification.verify(company);

    // 2. Application URL
    const applicationUrl = job.applicationUrl ?? job.sourceUrl;
    const relationship = domainRelationship({
      applicationUrl,
      companyDomain: companyCheck.domain,
      companyName: company.name,
      atsSlug: companyCheck.atsSlug,
    });
    const probe: UrlProbeResult = await this.urlProbe.probe(applicationUrl);

    const urlEvidence: Evidence[] = [
      {
        check: 'URL_DOMAIN_RELATIONSHIP',
        passed: relationship.weight > 0,
        weight: relationship.weight,
        detail: `${relationship.relationship}: ${relationship.detail}`,
      },
    ];
    if (probe.urlStatus === 'OK' || probe.urlStatus === 'REDIRECTED') {
      urlEvidence.push({
        check: 'HTTP_OK',
        passed: true,
        weight: 0.05,
        detail: `HTTP ${probe.httpStatus ?? '?'}`,
      });
      if (probe.applyFormDetected)
        urlEvidence.push({
          check: 'APPLY_FORM_PRESENT',
          passed: true,
          weight: 0.15,
          detail: 'application form detected',
        });
      else
        urlEvidence.push({
          check: 'APPLY_FORM_UNDETECTED',
          passed: false,
          weight: 0,
          detail: 'no form found (many pages load it dynamically)',
        });
    } else if (probe.urlStatus === 'BLOCKED') {
      urlEvidence.push({
        check: 'PAGE_BLOCKED',
        passed: false,
        weight: 0,
        detail: `HTTP ${probe.httpStatus ?? '?'} — cannot verify, not held against the job`,
      });
    } else if (probe.urlStatus === 'TIMEOUT' || probe.urlStatus === 'ERROR') {
      urlEvidence.push({
        check: 'PAGE_UNREACHABLE',
        passed: false,
        weight: -0.05,
        detail: probe.error ?? probe.urlStatus,
      });
    }

    // 3. Suspicion rules (job text + whatever the page returned)
    const salaryMaxInr =
      job.salaryCurrency === 'INR' && job.salaryMax ? Number(job.salaryMax) : null;
    const flags: SuspicionFlag[] = detectSuspiciousIndicators({
      title: job.title,
      description: job.description,
      companyName: company.name,
      companyDomain: companyCheck.domain,
      salaryMaxInr,
      fresherEligible: job.fresherEligible,
      applicationUrl,
      redirectChain: probe.redirectChain.map((r) => r.url),
      pageText: probe.pageText,
    });

    // 4. AI only for the ambiguous band or an unresolved soft flag (docs 08 §3.6)
    const provisional = decideValidation({
      companyEvidence: companyCheck.evidence,
      urlEvidence,
      urlStatus: probe.urlStatus,
      suspicionFlags: flags,
      closed: probe.closedMarkers.length > 0,
      companyBlocked: companyCheck.blocked,
    });

    let ai: { verdict: 'LEGIT' | 'SUSPICIOUS' | 'UNSURE'; confidence: number } | null = null;
    let usedAi = false;
    let aiUnavailable = false;
    const ambiguous =
      provisional.confidence >= AI_BAND.min && provisional.confidence <= AI_BAND.max;
    const softFlagged = flags.some((f) => !f.hard && f.weight <= SOFT_FLAG_THRESHOLD);
    const worthAsking =
      provisional.status !== 'EXPIRED' &&
      provisional.status !== 'INVALID' &&
      (ambiguous || softFlagged);

    if (worthAsking && aiAllowed) {
      if (!this.ai) {
        aiUnavailable = true;
      } else {
        const res = await this.ai.run(
          buildSuspicionRequest({
            title: job.title,
            companyName: company.name,
            description: job.description,
            ruleFlags: flags.map((f) => `${f.code}: ${f.detail}`),
            urlRelationship: `${relationship.relationship}: ${relationship.detail}`,
          }),
        );
        if (res.status === 'OK') {
          usedAi = true;
          ai = { verdict: res.data.verdict, confidence: res.data.confidence };
        } else {
          aiUnavailable = true;
        }
      }
    }

    const decision: Decision = ai
      ? decideValidation({
          companyEvidence: companyCheck.evidence,
          urlEvidence,
          urlStatus: probe.urlStatus,
          suspicionFlags: flags,
          closed: probe.closedMarkers.length > 0,
          companyBlocked: companyCheck.blocked,
          ai,
        })
      : provisional;

    await this.persist(job, decision, probe, relationship.relationship, flags, ai, usedAi);
    return { status: decision.status, usedAi, aiUnavailable };
  }

  private async persist(
    job: JobRow,
    decision: Decision,
    probe: UrlProbeResult,
    relationship: string,
    flags: SuspicionFlag[],
    ai: { verdict: string; confidence: number } | null,
    usedAi: boolean,
  ): Promise<void> {
    const now = new Date();
    const jobStatus: JobStatus =
      decision.status === 'VALID'
        ? 'VALID'
        : decision.status === 'EXPIRED'
          ? 'EXPIRED'
          : decision.status === 'INVALID'
            ? 'REJECTED'
            : decision.status === 'SUSPICIOUS'
              ? 'SUSPICIOUS'
              : 'NEEDS_REVIEW';
    const nextCheckAt = decision.jobActive ? new Date(Date.now() + nextCheckDelayMs(0)) : null;

    await this.db.transaction(async (tx) => {
      await tx
        .insert(jobValidation)
        .values({
          jobId: job.id,
          status: decision.status,
          confidence: decision.confidence.toFixed(2),
          companyVerified: decision.companyVerified,
          applicationVerified: decision.applicationVerified,
          jobActive: decision.jobActive,
          fresherEligible: job.fresherEligible,
          originalUrl: probe.originalUrl,
          finalUrl: probe.finalUrl,
          httpStatus: probe.httpStatus,
          redirectChain: probe.redirectChain,
          urlStatus: probe.urlStatus,
          urlDomainRelationship: relationship,
          suspiciousFlags: flags.map((f) => f.code),
          evidence: decision.evidence,
          aiAssessment: ai,
          attempts: 1,
          validatedAt: now,
          nextCheckAt,
        })
        .onConflictDoUpdate({
          target: jobValidation.jobId,
          set: {
            status: decision.status,
            confidence: decision.confidence.toFixed(2),
            companyVerified: decision.companyVerified,
            applicationVerified: decision.applicationVerified,
            jobActive: decision.jobActive,
            originalUrl: probe.originalUrl,
            finalUrl: probe.finalUrl,
            httpStatus: probe.httpStatus,
            redirectChain: probe.redirectChain,
            urlStatus: probe.urlStatus,
            urlDomainRelationship: relationship,
            suspiciousFlags: flags.map((f) => f.code),
            evidence: decision.evidence,
            aiAssessment: ai,
            attempts: sql`${jobValidation.attempts} + 1`,
            validatedAt: now,
            nextCheckAt,
            updatedAt: now,
          },
        });

      await tx
        .update(jobs)
        .set({
          status: jobStatus,
          validationStatus: decision.status,
          validationConfidence: decision.confidence.toFixed(2),
          finalApplicationUrl: probe.finalUrl,
          validatedAt: now,
          lastCheckedAt: now,
          nextCheckAt,
          closedAt: decision.jobActive ? null : now,
          stageError: null,
          updatedAt: now,
        })
        .where(eq(jobs.id, job.id));

      await tx.insert(jobEvents).values({
        jobId: job.id,
        type: 'VALIDATED',
        detail: {
          status: decision.status,
          confidence: decision.confidence,
          reason: decision.reason,
          urlStatus: probe.urlStatus,
          flags: flags.map((f) => f.code),
          usedAi,
        },
      });
    });
  }
}
