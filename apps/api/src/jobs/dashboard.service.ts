import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { DashboardSummary } from '@jobsentinel/types';
import { DB, type Db } from '../common/db/db.module';
import { JobsQueryService, LISTABLE } from './jobs-query.service';

const CARD_COUNT = 5;
/** A worker that has not checked in for this long is not running (docs 07 §3). */
const WORKER_STALE_MS = 30 * 60 * 1000;

interface CountsRow extends Record<string, unknown> {
  new_today: number;
  new_this_week: number;
  needs_review: number;
  saved: number;
  very_high: number;
  high: number;
  medium: number;
  other: number;
  applied: number;
  interview: number;
  selected: number;
  last_beat_at: string | Date | null;
  last_scan_at: string | Date | null;
  failing_sources: number;
}

/**
 * `GET /dashboard/summary` (docs 03 §5).
 *
 * Every counter is one statement of scalar subqueries rather than six separate round trips: this
 * is the most-loaded endpoint and it runs against a shared connection pooler, where the round
 * trips cost far more than the counting does (D54).
 */
@Injectable()
export class DashboardService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly query: JobsQueryService,
  ) {}

  async summary(userId: string): Promise<DashboardSummary> {
    const profileVersion = await this.query.profileVersion(userId);
    const now = Date.now();
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    // LISTABLE is a fixed internal constant, never user input.
    const listable = sql.raw(LISTABLE.map((s) => `'${s}'`).join(','));
    const visible = sql`j.status in (${listable}) and j.closed_at is null`;
    const scored = (band: string) => sql`
      (select count(*) from job_matches m join jobs j on j.id = m.job_id
        where m.user_id = ${userId} and m.profile_version = ${profileVersion}
          and ${visible} and m.priority = ${band})::int`;

    const [counts, recent, top] = await Promise.all([
      this.db.execute<CountsRow>(sql`
        select
          (select count(*) from jobs j where ${visible} and j.first_seen_at >= ${dayAgo}::timestamptz)::int as new_today,
          (select count(*) from jobs j where ${visible} and j.first_seen_at >= ${weekAgo}::timestamptz)::int as new_this_week,
          (select count(*) from jobs j where ${visible} and j.validation_status in ('NEEDS_REVIEW','SUSPICIOUS'))::int as needs_review,
          (select count(*) from saved_jobs where user_id = ${userId})::int as saved,
          ${scored('VERY_HIGH')} as very_high,
          ${scored('HIGH')} as high,
          ${scored('MEDIUM')} as medium,
          ${scored('OTHER')} as other,
          (select count(*) from applications where user_id = ${userId} and status = 'APPLIED')::int as applied,
          (select count(*) from applications where user_id = ${userId} and status = 'INTERVIEW')::int as interview,
          (select count(*) from applications where user_id = ${userId} and status = 'SELECTED')::int as selected,
          (select max(last_beat_at) from worker_heartbeats) as last_beat_at,
          (select max(last_successful_scan) from job_sources) as last_scan_at,
          (select count(*) from job_sources where status in ('FAILING','DISABLED'))::int as failing_sources
      `),
      this.query.list(userId, { sort: 'newest', limit: CARD_COUNT }),
      this.query.list(userId, { sort: 'score', limit: CARD_COUNT, minScore: 1 }),
    ]);

    const c = counts[0];
    return {
      newToday: c?.new_today ?? 0,
      newThisWeek: c?.new_this_week ?? 0,
      byPriority: {
        veryHigh: c?.very_high ?? 0,
        high: c?.high ?? 0,
        medium: c?.medium ?? 0,
        other: c?.other ?? 0,
      },
      needsReview: c?.needs_review ?? 0,
      saved: c?.saved ?? 0,
      applications: {
        applied: c?.applied ?? 0,
        interview: c?.interview ?? 0,
        selected: c?.selected ?? 0,
      },
      recentJobs: recent.items,
      topMatches: top.items,
      system: {
        workerAlive: isFresh(c?.last_beat_at ?? null),
        lastScanAt: toIso(c?.last_scan_at ?? null),
        failingSources: c?.failing_sources ?? 0,
      },
    };
  }
}

function toIso(value: string | Date | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function isFresh(value: string | Date | null): boolean {
  return value !== null && Date.now() - new Date(value).getTime() < WORKER_STALE_MS;
}
