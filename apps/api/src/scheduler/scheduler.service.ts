import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { Env } from '@jobsentinel/config';
import { ENV } from '../common/config/config.module';
import { DB, type Db } from '../common/db/db.module';
import { jobSources } from '../common/db/schema';
import { SourceManager, type ScanSummary, type SourceRow } from '../sources/source-manager';

const LEASE_MINUTES = 10;

/**
 * Database-driven scheduler (docs 07 §1): the schedule *is* `job_sources.next_scan_at`.
 * Due sources are leased with FOR UPDATE SKIP LOCKED so a second worker can never take the same one.
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
    private readonly manager: SourceManager,
  ) {}

  /** Lease up to `max` due sources: manual requests first, then priority, then fresher band, then oldest due. */
  async leaseDueSources(max: number, onlyIds?: string[]): Promise<SourceRow[]> {
    // An explicit id list (worker --sources=) bypasses the schedule: those sources are scanned now.
    // Each id is bound as its own parameter — interpolating the JS array gives Postgres a bare
    // string and it fails with "malformed array literal" (D64).
    const dueFilter = onlyIds?.length
      ? sql`and id in (${sql.join(
          onlyIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`
      : // An auto-paused source is never scanned on schedule; only a resume brings it back (F2, D103).
        sql`and enabled and status not in ('DISABLED', 'PAUSED_AUTO') and (next_scan_at is null or next_scan_at <= now())`;
    const rows = await this.db.execute<SourceRow>(sql`
      update job_sources set lease_until = now() + (${LEASE_MINUTES} * interval '1 minute'), last_attempted_scan = now()
      where id in (
        select id from job_sources
        where (lease_until is null or lease_until < now())
          ${dueFilter}
        order by
          (manual_requested_at is not null) desc,
          case priority when 'HIGH' then 0 when 'NORMAL' then 1 else 2 end,
          -- Within a priority, company boards that hire freshers often go first (F4, D118); every
          -- other band is equal, so a low or unknown score never pushes a board back.
          case when adapter in ('greenhouse', 'lever', 'ashby') and exists (
            select 1 from company_fresher_stats c
            where c.company_id = job_sources.company_id and c.band = 'HIGH'
          ) then 0 else 1 end,
          next_scan_at nulls first
        limit ${max}
        for update skip locked
      )
      returning *`);
    // drizzle's execute() returns snake_case rows; map them to the schema's camelCase shape
    return rows.map(mapRow);
  }

  /** One tick's worth of scanning: bounded fan-out, one source never affects another. */
  async runDueScans(
    opts: { maxSources?: number; concurrency?: number; sourceIds?: string[] } = {},
  ): Promise<ScanSummary[]> {
    const maxSources = opts.maxSources ?? this.env.WORKER_MAX_SOURCES_PER_TICK;
    const concurrency = Math.max(1, opts.concurrency ?? this.env.WORKER_SOURCE_CONCURRENCY);
    const due = await this.leaseDueSources(
      opts.sourceIds?.length ? opts.sourceIds.length : maxSources,
      opts.sourceIds,
    );
    if (due.length === 0) return [];
    this.logger.log(`scanning ${due.length} source(s): ${due.map((s) => s.name).join(', ')}`);

    const results: ScanSummary[] = [];
    const queue = [...due];
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (;;) {
        const source = queue.shift();
        if (!source) return;
        const trigger = source.manualRequestedAt
          ? 'MANUAL'
          : this.isRecovery(source)
            ? 'RECOVERY'
            : 'SCHEDULED';
        try {
          const summary = await this.manager.runScan(source, trigger);
          results.push(summary);
          this.logger.log(
            `${source.name}: ${summary.status} found=${summary.found} new=${summary.new} updated=${summary.updated} attached=${summary.attached} skipped=${summary.skipped} in ${summary.durationMs}ms`,
          );
        } catch (err) {
          // runScan handles its own failures; this guards against bugs in the manager itself.
          this.logger.error(
            `${source.name}: scan crashed: ${err instanceof Error ? err.stack : String(err)}`,
          );
          await this.db
            .update(jobSources)
            .set({ leaseUntil: null })
            .where(eq(jobSources.id, source.id));
        }
      }
    });
    await Promise.all(workers);
    return results;
  }

  /** A scan is "recovery" when the gap since the last success is more than twice the interval (docs 07 §2.2). */
  private isRecovery(source: SourceRow): boolean {
    if (!source.lastSuccessfulScan) return false;
    const intervalMs = (source.scanIntervalSec ?? 1800) * 1000;
    return Date.now() - source.lastSuccessfulScan.getTime() > 2 * intervalMs;
  }

  /** Dashboard "scan now": becomes due immediately and jumps the queue. */
  async requestManualScan(sourceId: string): Promise<void> {
    await this.db
      .update(jobSources)
      .set({ manualRequestedAt: new Date(), nextScanAt: new Date() })
      .where(eq(jobSources.id, sourceId));
  }
}

function mapRow(r: Record<string, unknown>): SourceRow {
  const d = (v: unknown) => (v ? new Date(v as string) : null);
  return {
    id: r.id as string,
    name: r.name as string,
    type: r.type as SourceRow['type'],
    adapter: r.adapter as string,
    baseUrl: (r.base_url as string) ?? null,
    config: r.config,
    companyId: (r.company_id as string) ?? null,
    enabled: r.enabled as boolean,
    priority: r.priority as SourceRow['priority'],
    scanIntervalSec: (r.scan_interval_sec as number) ?? null,
    minRequestGapMs: r.min_request_gap_ms as number,
    nextScanAt: d(r.next_scan_at),
    leaseUntil: d(r.lease_until),
    manualRequestedAt: d(r.manual_requested_at),
    lastAttemptedScan: d(r.last_attempted_scan),
    lastSuccessfulScan: d(r.last_successful_scan),
    lastCursor: (r.last_cursor as string) ?? null,
    lastSeenExternalId: (r.last_seen_external_id as string) ?? null,
    lastError: (r.last_error as string) ?? null,
    consecutiveFailures: r.consecutive_failures as number,
    status: r.status as SourceRow['status'],
    robotsCheckedAt: d(r.robots_checked_at),
    robotsAllowed: (r.robots_allowed as boolean) ?? null,
    pausedAt: d(r.paused_at),
    pausedReason: (r.paused_reason as string) ?? null,
    resumedAt: d(r.resumed_at),
    keptZeroAlertedAt: d(r.kept_zero_alerted_at),
    createdAt: d(r.created_at)!,
    updatedAt: d(r.updated_at)!,
  };
}
