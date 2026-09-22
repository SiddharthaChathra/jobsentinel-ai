import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type {
  ApplicationItem,
  ApplicationHistoryEntry,
  ApplicationsQuery,
  ApplicationUpsert,
  JobCard,
  SavedJobsQuery,
} from '@jobsentinel/types';
import { DB, type Db } from '../common/db/db.module';
import { applications, jobs, savedJobs } from '../common/db/schema';
import { AppError } from '../common/errors/app-error';
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
      })
      .onConflictDoUpdate({
        target: [applications.userId, applications.jobId],
        set: {
          status: body.status,
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

  async remove(userId: string, jobId: string): Promise<void> {
    await this.db
      .delete(applications)
      .where(and(eq(applications.userId, userId), eq(applications.jobId, jobId)));
  }
}

function encodeTimeCursor(at: Date): string {
  return Buffer.from(at.toISOString()).toString('base64url');
}

function decodeTimeCursor(raw: string | undefined): Date | null {
  if (!raw) return null;
  const at = new Date(Buffer.from(raw, 'base64url').toString('utf8'));
  return Number.isNaN(at.getTime()) ? null : at;
}
