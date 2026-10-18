import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { REMINDERS } from '@jobsentinel/config';
import type {
  ApplicationDatesInput,
  ApplicationItem,
  ApplicationHistoryEntry,
  ApplicationsQuery,
  ApplicationUpsert,
  JobCard,
  SavedJobsQuery,
} from '@jobsentinel/types';
import { DB, type Db } from '../common/db/db.module';
import { applications, jobs, notificationSettings, savedJobs } from '../common/db/schema';
import { AppError } from '../common/errors/app-error';
import { statusChangedAt } from './jobs-detail.service';
import { JobsQueryService } from './jobs-query.service';

const DEFAULT_LIMIT = 25;

/** Saved jobs and the application tracker (docs 03 §4). */
@Injectable()
export class TrackerService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly query: JobsQueryService,
  ) {}

  async saved(
    userId: string,
    q: SavedJobsQuery,
  ): Promise<{ items: JobCard[]; nextCursor: string | null }> {
    const limit = q.limit ?? DEFAULT_LIMIT;
    const before = decodeTimeCursor(q.cursor);
    const rows = await this.db
      .select({ jobId: savedJobs.jobId, savedAt: savedJobs.createdAt })
      .from(savedJobs)
      .where(
        and(eq(savedJobs.userId, userId), ...(before ? [lt(savedJobs.createdAt, before)] : [])),
      )
      .orderBy(desc(savedJobs.createdAt))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const cards = await this.query.cardsByIds(
      userId,
      page.map((r) => r.jobId),
    );
    // Saved order is what the user expects, so the card map is re-ordered rather than sorted.
    const items = page.map((r) => cards.get(r.jobId)).filter((c): c is JobCard => Boolean(c));
    const last = page[page.length - 1];
    return {
      items,
      nextCursor: rows.length > limit && last ? encodeTimeCursor(last.savedAt) : null,
    };
  }

  async applications(
    userId: string,
    q: ApplicationsQuery,
  ): Promise<{ items: ApplicationItem[]; nextCursor: string | null }> {
    const limit = q.limit ?? DEFAULT_LIMIT;
    const before = decodeTimeCursor(q.cursor);
    const rows = await this.db
      .select()
      .from(applications)
      .where(
        and(
          eq(applications.userId, userId),
          ...(q.status?.length ? [inArray(applications.status, q.status)] : []),
          ...(before ? [lt(applications.updatedAt, before)] : []),
        ),
      )
      .orderBy(desc(applications.updatedAt))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const cards = await this.query.cardsByIds(
      userId,
      page.map((r) => r.jobId),
    );
    const followUpDays = await this.followUpDays(userId);
    const items = page
      .map((r): ApplicationItem | null => {
        const job = cards.get(r.jobId);
        if (!job) return null;
        return {
          job,
          status: r.status,
          appliedAt: r.appliedAt?.toISOString() ?? null,
          notes: r.notes,
          history: r.history as ApplicationHistoryEntry[],
          updatedAt: r.updatedAt.toISOString(),
          deadline:
            (r.deadline ?? (job.deadline ? new Date(job.deadline) : null))?.toISOString() ?? null,
          interviewAt: r.interviewAt?.toISOString() ?? null,
          followUpAt: effectiveFollowUp(r, followUpDays)?.toISOString() ?? null,
          lastStatusChangeAt: r.lastStatusChangeAt?.toISOString() ?? null,
        };
      })
      .filter((x): x is ApplicationItem => x !== null);
    const last = page[page.length - 1];
    return {
      items,
      nextCursor: rows.length > limit && last ? encodeTimeCursor(last.updatedAt) : null,
    };
  }

  async upsert(userId: string, jobId: string, body: ApplicationUpsert): Promise<ApplicationItem> {
    const exists = await this.db.query.jobs.findFirst({
      where: eq(jobs.id, jobId),
      columns: { id: true },
    });
    if (!exists) throw AppError.notFound('JOB_NOT_FOUND');

    const entry: ApplicationHistoryEntry = { status: body.status, at: new Date().toISOString() };
    // APPLIED without an explicit date means "just now" — the user should not have to say so.
    const appliedAt =
      body.appliedAt !== undefined
        ? new Date(body.appliedAt)
        : body.status === 'APPLIED'
          ? new Date()
          : undefined;

    await this.db
      .insert(applications)
      .values({
        userId,
        jobId,
        status: body.status,
        notes: body.notes ?? null,
        appliedAt: appliedAt ?? null,
        history: [entry],
        lastStatusChangeAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [applications.userId, applications.jobId],
        set: {
          status: body.status,
          lastStatusChangeAt: statusChangedAt(),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          // An existing applied date is never overwritten by a later status change.
          ...(appliedAt
            ? {
                appliedAt: sql`coalesce(${applications.appliedAt}, ${appliedAt.toISOString()}::timestamptz)`,
              }
            : {}),
          history: sql`coalesce(${applications.history}, '[]'::jsonb) || ${JSON.stringify([entry])}::jsonb`,
          updatedAt: new Date(),
        },
      });

    const page = await this.applications(userId, {
      status: undefined,
      cursor: undefined,
      limit: 100,
    });
    const item = page.items.find((i) => i.job.id === jobId);
    if (!item) throw AppError.notFound('APPLICATION_NOT_FOUND');
    return item;
  }

  /**
   * `PATCH /applications/:jobId/dates` — the tracker's date pickers (F5, D119). Creates the
   * tracker row as VIEWED when there is none, so a saved job can carry a deadline. The reminder
   * planner picks the change up on its next run; a moved date cancels the old reminders.
   */
  async setDates(
    userId: string,
    jobId: string,
    body: ApplicationDatesInput,
  ): Promise<ApplicationItem> {
    const exists = await this.db.query.jobs.findFirst({
      where: eq(jobs.id, jobId),
      columns: { id: true },
    });
    if (!exists) throw AppError.notFound('JOB_NOT_FOUND');
    const toDate = (v: string | null | undefined) =>
      v === undefined ? undefined : v === null ? null : new Date(v);
    const dates = {
      ...(body.deadline !== undefined ? { deadline: toDate(body.deadline) } : {}),
      ...(body.interviewAt !== undefined ? { interviewAt: toDate(body.interviewAt) } : {}),
      ...(body.followUpAt !== undefined ? { followUpAt: toDate(body.followUpAt) } : {}),
    };
    await this.db
      .insert(applications)
      .values({
        userId,
        jobId,
        status: 'VIEWED',
        history: [{ status: 'VIEWED', at: new Date().toISOString() }],
        lastStatusChangeAt: new Date(),
        ...dates,
      })
      .onConflictDoUpdate({
        target: [applications.userId, applications.jobId],
        set: { ...dates, updatedAt: new Date() },
      });
    const page = await this.applications(userId, {
      status: undefined,
      cursor: undefined,
      limit: 100,
    });
    const item = page.items.find((i) => i.job.id === jobId);
    if (!item) throw AppError.notFound('APPLICATION_NOT_FOUND');
    return item;
  }

  private async followUpDays(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ days: notificationSettings.followUpDays })
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, userId))
      .limit(1);
    return row?.days ?? REMINDERS.followUpDays.default;
  }

  async remove(userId: string, jobId: string): Promise<void> {
    await this.db
      .delete(applications)
      .where(and(eq(applications.userId, userId), eq(applications.jobId, jobId)));
  }
}

/** When the follow-up reminder fires: the user's override, or last status change + N days. */
function effectiveFollowUp(
  r: { status: string; followUpAt: Date | null; lastStatusChangeAt: Date | null },
  days: number,
): Date | null {
  if (r.followUpAt) return r.followUpAt;
  if (r.status !== 'APPLIED' || !r.lastStatusChangeAt) return null;
  return new Date(r.lastStatusChangeAt.getTime() + days * 86_400_000);
}

function encodeTimeCursor(at: Date): string {
  return Buffer.from(at.toISOString()).toString('base64url');
}

function decodeTimeCursor(raw: string | undefined): Date | null {
  if (!raw) return null;
  const at = new Date(Buffer.from(raw, 'base64url').toString('utf8'));
  return Number.isNaN(at.getTime()) ? null : at;
}
