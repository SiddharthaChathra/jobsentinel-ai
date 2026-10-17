import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type {
  ExperienceLevel,
  JobStatus,
  SourceReport,
  SourceReportRow,
  SourceStatus,
  ValidationStatus,
} from '@jobsentinel/types';
import {
  AUTO_PAUSE_DAYS,
  decideAutoPause,
  sourceHealth,
  tally,
  type CollectedJob,
} from '@jobsentinel/validation';
import { DB, type Db } from '../common/db/db.module';
import { companies, jobSources } from '../common/db/schema';
import { AppError } from '../common/errors/app-error';
import { fresherRoleSql, LISTABLE } from '../jobs/jobs-query.service';

interface CollectedRow extends Record<string, unknown> {
  source_id: string;
  status: JobStatus;
  validation_status: ValidationStatus | null;
  closed: boolean;
  posted_or_seen_at: string | Date;
  experience_level: ExperienceLevel;
  experience_min_years: string | null;
  filter_reason: string | null;
}

export interface PausedSource {
  id: string;
  name: string;
  reason: string;
}

/**
 * Source report card and auto-pause (F2, D103). The rules are pure functions in
 * @jobsentinel/validation; this fetches the rows and applies them.
 */
@Injectable()
export class SourceReportService {
  private readonly logger = new Logger(SourceReportService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  async report(days: 7 | 30, now = new Date()): Promise<SourceReport> {
    const since = new Date(now.getTime() - days * 86_400_000);
    const [sources, collected, lastKept] = await Promise.all([
      this.db
        .select({ source: jobSources, company: { id: companies.id, name: companies.name } })
        .from(jobSources)
        .leftJoin(companies, eq(companies.id, jobSources.companyId))
        .orderBy(jobSources.name),
      this.collectedSince(since),
      this.lastKeptAt(),
    ]);

    const bySource = new Map<string, CollectedJob[]>();
    for (const row of collected) {
      const list = bySource.get(row.source_id) ?? [];
      list.push(toCollected(row));
      bySource.set(row.source_id, list);
    }

    const rows: SourceReportRow[] = sources.map(({ source, company }) => {
      const t = tally(bySource.get(source.id) ?? [], now);
      return {
        id: source.id,
        name: source.name,
        type: source.type,
        adapter: source.adapter,
        company: company?.id ? { id: company.id, name: company.name } : null,
        status: source.status,
        health: sourceHealth(source.status, t),
        createdAt: source.createdAt.toISOString(),
        collected: t.collected,
        kept: t.kept,
        rejected: t.rejected,
        lastKeptAt: lastKept.get(source.id) ?? null,
        lastSuccessfulScan: source.lastSuccessfulScan?.toISOString() ?? null,
        lastError: source.lastError,
        consecutiveFailures: source.consecutiveFailures,
        pausedAt: source.pausedAt?.toISOString() ?? null,
        pausedReason: source.pausedReason,
        resumedAt: source.resumedAt?.toISOString() ?? null,
      };
    });

    return {
      days,
      generatedAt: now.toISOString(),
      totals: {
        collected: rows.reduce((n, r) => n + r.collected, 0),
        kept: rows.reduce((n, r) => n + r.kept, 0),
      },
      sources: rows,
    };
  }

  /**
   * Pauses every ACTIVE source that collected jobs but kept none over the last 30 days (F2).
   * Idempotent: the update is conditional on the status still being ACTIVE, so a concurrent run
   * or a repeat pauses (and reports) each source once.
   */
  async autoPause(now = new Date(), sourceIds?: string[]): Promise<PausedSource[]> {
    const { sources } = await this.report(AUTO_PAUSE_DAYS, now);
    const candidates = sources.filter((s) => !sourceIds || sourceIds.includes(s.id));
    const paused: PausedSource[] = [];
    for (const s of candidates) {
      const decision = decideAutoPause({
        status: s.status,
        createdAt: new Date(s.createdAt),
        resumedAt: s.resumedAt ? new Date(s.resumedAt) : null,
        last30: { collected: s.collected, kept: s.kept, rejected: s.rejected },
        now,
      });
      if (!decision.pause) continue;
      const updated = await this.db
        .update(jobSources)
        .set({
          status: 'PAUSED_AUTO',
          pausedAt: now,
          pausedReason: decision.reason,
          leaseUntil: null,
          updatedAt: now,
        })
        .where(and(eq(jobSources.id, s.id), eq(jobSources.status, 'ACTIVE')))
        .returning({ id: jobSources.id });
      if (updated.length === 0) continue;
      this.logger.warn(`auto-paused ${s.name}: ${decision.reason}`);
      paused.push({ id: s.id, name: s.name, reason: decision.reason });
    }
    return paused;
  }

  /** One-click resume: back to ACTIVE, scanned on the next tick, with a fresh 30-day grace. */
  async resume(id: string, now = new Date()): Promise<{ id: string; status: SourceStatus }> {
    const [row] = await this.db
      .update(jobSources)
      .set({
        status: 'ACTIVE',
        resumedAt: now,
        pausedAt: null,
        pausedReason: null,
        nextScanAt: now,
        updatedAt: now,
      })
      .where(and(eq(jobSources.id, id), inArray(jobSources.status, ['PAUSED_AUTO'])))
      .returning({ id: jobSources.id, status: jobSources.status });
    if (row) return row;
    const [exists] = await this.db
      .select({ status: jobSources.status })
      .from(jobSources)
      .where(eq(jobSources.id, id))
      .limit(1);
    if (!exists) throw AppError.notFound('SOURCE_NOT_FOUND', 'Source not found');
    throw AppError.conflict('SOURCE_NOT_PAUSED', `Source is ${exists.status}, not auto-paused`);
  }

  /** Every job a source first saw since `since`, with what the report needs to judge it. */
  private collectedSince(since: Date): Promise<CollectedRow[]> {
    return this.db.execute<CollectedRow>(sql`
      select m.source_id, j.status, j.validation_status, (j.closed_at is not null) as closed,
        coalesce(j.posted_at, j.first_seen_at) as posted_or_seen_at,
        j.experience_level, j.experience_min_years,
        case when j.status = 'FILTERED_OUT' then (
          select e.detail->>'reason' from job_events e
          where e.job_id = j.id and e.type = 'FILTERED_OUT'
          order by e.created_at desc limit 1
        ) end as filter_reason
      from job_source_mappings m
      join jobs j on j.id = m.job_id
      where m.first_seen_at >= ${since.toISOString()}::timestamptz`);
  }

  /**
   * Last time each source found a job that passed the gates, at any time: history, so neither
   * the 60-day window nor a later close removes it.
   */
  private async lastKeptAt(): Promise<Map<string, string>> {
    // LISTABLE is a fixed internal constant, never user input.
    const listable = sql.raw(LISTABLE.map((s) => `'${s}'`).join(','));
    const rows = await this.db.execute<{ source_id: string; at: string | Date }>(sql`
      select m.source_id, max(m.first_seen_at) as at
      from job_source_mappings m
      join jobs j on j.id = m.job_id
      where j.status in (${listable}) and j.validation_status = 'VALID'
        and ${fresherRoleSql('j')}
      group by m.source_id`);
    return new Map(rows.map((r) => [r.source_id, new Date(r.at).toISOString()]));
  }
}

function toCollected(r: CollectedRow): CollectedJob {
  return {
    status: r.status,
    validationStatus: r.validation_status,
    closed: r.closed,
    postedOrSeenAt: new Date(r.posted_or_seen_at),
    experienceLevel: r.experience_level,
    experienceMinYears: r.experience_min_years === null ? null : Number(r.experience_min_years),
    filterReason: r.filter_reason,
  };
}
