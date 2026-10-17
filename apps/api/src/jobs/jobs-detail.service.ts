import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type {
  ApplicationStatus,
  JobDetail,
  JobEventItem,
  JobMatchDetail,
  JobSourceRef,
  JobValidationDetail,
  TrackerState,
} from '@jobsentinel/types';
import { DB, type Db } from '../common/db/db.module';
import {
  applications,
  jobEvents,
  jobMatches,
  jobSourceMappings,
  jobSources,
  jobValidation,
  jobs,
  savedJobs,
} from '../common/db/schema';
import { AppError } from '../common/errors/app-error';
import { JobsQueryService } from './jobs-query.service';

const EVENT_LIMIT = 10;
/** Mirrors the matching pre-filter: below it, no AI call was ever intended (D53). */
const AI_PREFILTER_MIN = 35;

/** Single-job read (docs 03 §3): the card plus everything the detail page shows. */
@Injectable()
export class JobsDetailService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly query: JobsQueryService,
  ) {}

  async detail(userId: string, jobId: string): Promise<JobDetail> {
    const cards = await this.query.cardsByIds(userId, [jobId]);
    const card = cards.get(jobId);
    if (!card) throw AppError.notFound('JOB_NOT_FOUND');

    const job = await this.db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
    if (!job) throw AppError.notFound('JOB_NOT_FOUND');

    const profileVersion = await this.query.profileVersion(userId);
    const [validation, match, events, sources] = await Promise.all([
      this.db.query.jobValidation.findFirst({ where: eq(jobValidation.jobId, jobId) }),
      this.db.query.jobMatches.findFirst({
        where: and(
          eq(jobMatches.jobId, jobId),
          eq(jobMatches.userId, userId),
          eq(jobMatches.profileVersion, profileVersion),
        ),
      }),
      this.db
        .select()
        .from(jobEvents)
        .where(eq(jobEvents.jobId, jobId))
        .orderBy(desc(jobEvents.createdAt))
        .limit(EVENT_LIMIT),
      this.db
        .select({
          name: jobSources.name,
          url: jobSourceMappings.sourceUrl,
          firstSeenAt: jobSourceMappings.firstSeenAt,
        })
        .from(jobSourceMappings)
        .innerJoin(jobSources, eq(jobSources.id, jobSourceMappings.sourceId))
        .where(eq(jobSourceMappings.jobId, jobId))
        .orderBy(desc(jobSourceMappings.isPrimary)),
    ]);

    const { match: _cardMatch, ...rest } = card;
    return {
      ...rest,
      description: job.description,
      requirements: job.requirements,
      skills: job.skills,
      sourceUrl: job.sourceUrl,
      sources: sources.map((s): JobSourceRef => ({
        name: s.name,
        url: s.url,
        firstSeenAt: s.firstSeenAt.toISOString(),
      })),
      validationDetail: {
        ...card.validation,
        companyVerified: validation?.companyVerified ?? card.validation.companyVerified,
        applicationVerified: validation?.applicationVerified ?? card.validation.applicationVerified,
        jobActive: validation?.jobActive ?? card.validation.jobActive,
        urlStatus: validation?.urlStatus ?? null,
        httpStatus: validation?.httpStatus ?? null,
        finalUrl: validation?.finalUrl ?? null,
        evidence: toEvidenceItems(validation?.evidence),
        suspiciousFlags: validation?.suspiciousFlags ?? [],
        aiAssessment: (validation?.aiAssessment ?? null) as JobValidationDetail['aiAssessment'],
        checkedAt: validation?.validatedAt?.toISOString() ?? null,
        nextCheckAt: validation?.nextCheckAt?.toISOString() ?? null,
      },
      match: match
        ? ({
            overallScore: match.overallScore,
            priority: match.priority,
            matchedSkills: match.matchedSkills,
            skillScore: match.skillScore,
            roleScore: match.roleScore,
            experienceScore: match.experienceScore,
            locationScore: match.locationScore,
            missingSkills: match.missingSkills,
            explanation: match.explanation,
            aiProvider: match.aiProvider,
            scoring: match.scoring,
            aiPending: match.aiProvider === null && match.overallScore >= AI_PREFILTER_MIN,
          } satisfies JobMatchDetail)
        : null,
      events: events.map((e): JobEventItem => ({
        id: e.id,
        type: e.type,
        detail: e.detail as Record<string, unknown>,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  async events(jobId: string): Promise<JobEventItem[]> {
    const rows = await this.db
      .select()
      .from(jobEvents)
      .where(eq(jobEvents.jobId, jobId))
      .orderBy(desc(jobEvents.createdAt))
      .limit(50);
    return rows.map((e) => ({
      id: e.id,
      type: e.type,
      detail: e.detail as Record<string, unknown>,
      createdAt: e.createdAt.toISOString(),
    }));
  }

  /** `POST /jobs/:id/view` — idempotent; only ever creates the tracker row, never downgrades it. */
  async markViewed(userId: string, jobId: string): Promise<TrackerState> {
    await this.assertJobExists(jobId);
    await this.db
      .insert(applications)
      .values({
        userId,
        jobId,
        status: 'VIEWED',
        history: [{ status: 'VIEWED', at: new Date().toISOString() }],
      })
      .onConflictDoNothing({ target: [applications.userId, applications.jobId] });
    return this.query.trackerState(userId, jobId);
  }

  async setSaved(userId: string, jobId: string, saved: boolean): Promise<TrackerState> {
    await this.assertJobExists(jobId);
    if (saved) {
      await this.db
        .insert(savedJobs)
        .values({ userId, jobId })
        .onConflictDoNothing({ target: [savedJobs.userId, savedJobs.jobId] });
    } else {
      await this.db
        .delete(savedJobs)
        .where(and(eq(savedJobs.userId, userId), eq(savedJobs.jobId, jobId)));
    }
    return this.query.trackerState(userId, jobId);
  }

  /**
   * `POST /jobs/:id/not-interested`. The job is not deleted or hidden from the database — it is
   * marked on this user's tracker, so the decision is reversible and auditable (spec principle 9).
   */
  async notInterested(userId: string, jobId: string, reason?: string): Promise<TrackerState> {
    await this.assertJobExists(jobId);
    const status: ApplicationStatus = 'NOT_INTERESTED';
    const entry = { status, at: new Date().toISOString(), ...(reason ? { note: reason } : {}) };
    await this.db
      .insert(applications)
      .values({ userId, jobId, status, notes: reason ?? null, history: [entry] })
      .onConflictDoUpdate({
        target: [applications.userId, applications.jobId],
        set: {
          status,
          notes: reason ?? null,
          history: sqlAppendHistory(entry),
          updatedAt: new Date(),
        },
      });
    await this.db
      .delete(savedJobs)
      .where(and(eq(savedJobs.userId, userId), eq(savedJobs.jobId, jobId)));
    return this.query.trackerState(userId, jobId);
  }

  private async assertJobExists(jobId: string): Promise<void> {
    const row = await this.db.query.jobs.findFirst({
      where: eq(jobs.id, jobId),
      columns: { id: true },
    });
    if (!row) throw AppError.notFound('JOB_NOT_FOUND');
  }
}

/**
 * The validation engine stores its evidence as `{ check, passed, weight, detail }` (packages/
 * validation `Evidence`), but the API contract names the identifier `code` (docs 03 §3). Passing
 * the jsonb straight through left `code` undefined, so every evidence line rendered without its
 * label. Rows written before or after either shape are accepted, and anything malformed is dropped
 * rather than shown as a blank line.
 */
export function toEvidenceItems(stored: unknown): JobValidationDetail['evidence'] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((raw: unknown) => {
    if (typeof raw !== 'object' || raw === null) return [];
    const e = raw as Record<string, unknown>;
    const code = typeof e.check === 'string' ? e.check : e.code;
    if (typeof code !== 'string' || typeof e.weight !== 'number') return [];
    return [
      { code, weight: e.weight, ...(typeof e.detail === 'string' ? { detail: e.detail } : {}) },
    ];
  });
}

/** Appends one entry to the jsonb history array without reading it back first. */
function sqlAppendHistory(entry: Record<string, unknown>) {
  return sql`coalesce(${applications.history}, '[]'::jsonb) || ${JSON.stringify([entry])}::jsonb`;
}
