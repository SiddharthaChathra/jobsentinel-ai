import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { ScanTrigger } from '@jobsentinel/types';
import {
  boardIntervalSec,
  checkQuota,
  windowStart,
  type QuotaDecision,
  type QuotaWindow,
} from '@jobsentinel/validation';
import type { Env } from '@jobsentinel/config';
import type { FresherBand } from '@jobsentinel/types';
import { ENV } from '../common/config/config.module';
import { DB, type Db } from '../common/db/db.module';
import { jobSources, scanRuns } from '../common/db/schema';
import { HTTP_CLIENT } from '../common/http/http.module';
import type { HttpClientPort } from '../common/http/http-client';
import { CompaniesService } from '../jobs/companies.service';
import { DedupeService, type DedupeItem, type DedupeOutcome } from '../jobs/dedupe.service';
import { normalizeRawJob } from '../jobs/normalizer';
import { AuditLogger } from '../system/audit-logger';
import { SourceBlockedError, type FetchContext } from './job-source';
import { CompanyFresherService } from './company-fresher.service';
import { SourceRegistry } from './source-registry';

/** Adapters that read one company's own board; only these are spaced by its fresher score (F4). */
const COMPANY_BOARD_ADAPTERS = new Set(['greenhouse', 'lever', 'ashby']);

export type SourceRow = typeof jobSources.$inferSelect;

/** When to look again after a quota refusal: soon for a short window, later for a long one. */
const QUOTA_RETRY_MS: Record<QuotaWindow, number> = {
  perMinute: 2 * 60_000,
  perDay: 60 * 60_000,
  perWeek: 6 * 3_600_000,
  perMonth: 12 * 3_600_000,
};

export interface ScanSummary {
  scanRunId: string;
  /** SKIPPED_QUOTA: not run — it would have exceeded the provider's published quota (D108). */
  status: 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'SKIPPED_QUOTA';
  found: number;
  new: number;
  updated: number;
  attached: number;
  skipped: number;
  durationMs: number;
  error?: string;
}

/** Overlap re-covered on every scan so nothing posted during the previous run is missed (docs 07 §2.1). */
const SINCE_OVERLAP_MS = 15 * 60_000;
const MAX_ITEMS_PER_SCAN = 1000;
const BATCH_SIZE = 50;

/**
 * Runs exactly one scan of one source: creates the scan_runs row, streams RawJobs through
 * normalize → dedupe with per-record isolation, then updates the source's schedule/health.
 * The cursor (`last_successful_scan`) only advances on success (docs 06 §4, 07 §2).
 */
@Injectable()
export class SourceManager {
  private readonly logger = new Logger(SourceManager.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
    @Inject(HTTP_CLIENT) private readonly http: HttpClientPort,
    private readonly registry: SourceRegistry,
    private readonly companies: CompaniesService,
    private readonly dedupe: DedupeService,
    private readonly audit: AuditLogger,
    private readonly fresher: CompanyFresherService,
  ) {}

  async runScan(source: SourceRow, trigger: ScanTrigger): Promise<ScanSummary> {
    // Quota first, manual scans included: a refused scan creates no run, makes no request and is
    // not a failure (no backoff) — it is simply postponed (D108).
    const quota = await this.quotaFor(source);
    if (quota && !quota.allowed) {
      const retryMs = QUOTA_RETRY_MS[quota.window];
      await this.db
        .update(jobSources)
        .set({
          leaseUntil: null,
          nextScanAt: sql`now() + (${Math.round(retryMs / 1000)} * interval '1 second')`,
        })
        .where(eq(jobSources.id, source.id));
      this.logger.warn(
        `${source.name}: skipped — ${quota.window} quota ${quota.used}/${quota.cap} would be exceeded`,
      );
      return {
        scanRunId: '',
        status: 'SKIPPED_QUOTA',
        found: 0,
        new: 0,
        updated: 0,
        attached: 0,
        skipped: 0,
        durationMs: 0,
        error: `quota ${quota.window} ${quota.used}/${quota.cap}`,
      };
    }
    const startedAt = new Date();
    const [run] = await this.db
      .insert(scanRuns)
      .values({
        sourceId: source.id,
        trigger,
        startedAt,
        status: 'RUNNING',
        windowFrom: source.lastSuccessfulScan,
      })
      .returning({ id: scanRuns.id });
    const scanRunId = run!.id;
    const counts = { found: 0, new: 0, updated: 0, attached: 0, skipped: 0, requests: 0 };
    let cursor: string | null = source.lastCursor;

    const finish = async (
      status: Exclude<ScanSummary['status'], 'SKIPPED_QUOTA'>,
      error?: string,
    ): Promise<ScanSummary> => {
      const durationMs = Date.now() - startedAt.getTime();
      await this.db
        .update(scanRuns)
        .set({
          status,
          completedAt: new Date(),
          windowTo: startedAt,
          jobsFound: counts.found,
          jobsNew: counts.new,
          jobsUpdated: counts.updated + counts.attached,
          jobsSkipped: counts.skipped,
          requestsMade: counts.requests,
          errorMessage: error ?? null,
          durationMs,
        })
        .where(eq(scanRuns.id, scanRunId));
      if (status === 'SUCCEEDED') await this.markSuccess(source, startedAt, cursor);
      else await this.markFailure(source, error ?? status, error?.startsWith('BLOCKED') ?? false);
      await this.audit.event(
        'SCAN',
        `${source.name}: ${status}`,
        { trigger, ...counts, durationMs, error },
        { sourceId: source.id, level: status === 'SUCCEEDED' ? 'INFO' : 'WARN' },
      );
      return { scanRunId, status, ...counts, durationMs, error };
    };

    const adapter = this.registry.get(source.adapter);
    if (!adapter) return finish('FAILED', `unknown adapter "${source.adapter}"`);
    const config = adapter.configSchema.safeParse(source.config);
    if (!config.success)
      return finish(
        'FAILED',
        `invalid config: ${config.error.issues.map((i) => i.message).join('; ')}`,
      );

    const company = source.companyId
      ? await this.db.query.companies.findFirst({
          where: (c, { eq: e }) => e(c.id, source.companyId!),
        })
      : null;
    const since = source.lastSuccessfulScan
      ? new Date(source.lastSuccessfulScan.getTime() - SINCE_OVERLAP_MS)
      : null;
    const ctx: FetchContext = {
      since,
      cursor,
      http: this.countingHttp(() => counts.requests++),
      log: {
        debug: (m, c) => this.logger.debug(`${source.name}: ${m} ${c ? JSON.stringify(c) : ''}`),
        warn: (m, c) => this.logger.warn(`${source.name}: ${m} ${c ? JSON.stringify(c) : ''}`),
      },
      maxItems: MAX_ITEMS_PER_SCAN,
      setCursor: (next) => (cursor = next),
    };

    const deadline = Date.now() + this.env.SOURCE_SCAN_TIMEOUT_MS;
    const dedupeCtx = await this.dedupe.createContext(source.id);
    const companyCache = new Map<string, string>(); // normalized name → id, per scan
    if (company) companyCache.set(company.normalizedName, company.id);
    let batch: DedupeItem[] = [];
    const flush = async (): Promise<void> => {
      if (batch.length === 0) return;
      const items = batch;
      batch = [];
      const outcomes = await this.dedupe.upsertBatch(items, dedupeCtx);
      for (const o of outcomes) bump(counts, o.outcome);
    };

    try {
      for await (const raw of adapter.fetchJobs(config.data, ctx)) {
        if (Date.now() > deadline) {
          await flush().catch(() => undefined);
          return finish(
            'TIMED_OUT',
            `exceeded ${this.env.SOURCE_SCAN_TIMEOUT_MS} ms after ${counts.found} items`,
          );
        }
        counts.found++;
        try {
          const normalized = normalizeRawJob(raw, {
            fallbackCompanyName: company?.name,
            fallbackCompanyDomain: company?.websiteDomain,
          });
          // Single-company sources: the source's company is authoritative unless the record names another one.
          let companyId =
            !raw.companyName && company
              ? company.id
              : companyCache.get(normalized.normalizedCompany);
          if (!companyId) {
            companyId = (
              await this.companies.findOrCreate({
                name: normalized.companyName,
                normalizedName: normalized.normalizedCompany,
                domain: normalized.companyDomain,
              })
            ).id;
            companyCache.set(normalized.normalizedCompany, companyId);
          }
          batch.push({ job: normalized, companyId, raw });
        } catch (err) {
          counts.skipped++;
          this.logger.warn(
            `${source.name}: skipped ${raw.externalId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        if (batch.length >= BATCH_SIZE) await flush();
      }
      await flush();
      return finish('SUCCEEDED');
    } catch (err) {
      await flush().catch(() => undefined);
      if (err instanceof SourceBlockedError)
        return finish('FAILED', `BLOCKED ${err.status}: ${err.message}`);
      return finish('FAILED', err instanceof Error ? err.message : String(err));
    }
  }

  /** On success the cursor moves to the scan's *start* time and health resets (docs 07 §2.1). */
  /**
   * The source's scan interval, never below what its adapter declares safe. The adapter's minimum
   * was enforced only when a source was created or edited through the API, so seeded Adzuna sources
   * fell back to the hourly LOW default and ran ~34 scans a day against a 250/day quota (D108).
   */
  private intervalSec(source: SourceRow, band: FresherBand | null = null): number {
    return boardIntervalSec({
      configuredSec: source.scanIntervalSec,
      priority: source.priority,
      floorSec: this.registry.get(source.adapter)?.metadata.minIntervalSec ?? 0,
      band,
    });
  }

  /**
   * A company board's fresher band (F4, D118): HIGH is scanned twice as often, LOW half as often,
   * within the adapter's floor. Keyword and aggregator sources span many companies: no band.
   */
  private async boardBand(source: SourceRow): Promise<FresherBand | null> {
    if (!source.companyId || !COMPANY_BOARD_ADAPTERS.has(source.adapter)) return null;
    return this.fresher.bandFor(source.companyId);
  }

  /** Rolling-window usage for providers with a published quota; null for those without. */
  private async quotaFor(source: SourceRow): Promise<QuotaDecision | null> {
    if (source.adapter !== 'adzuna') return null;
    const now = new Date();
    const at = (w: QuotaWindow) => windowStart(w, now).toISOString();
    const maxPages = Number((source.config as { maxPages?: unknown } | null)?.maxPages ?? 2) || 2;
    // A scan still RUNNING has made requests that are not counted yet: reserve its pages.
    const [row] = await this.db.execute<Record<QuotaWindow, number>>(sql`
      select
        coalesce(sum(case when r.status = 'RUNNING' then ${maxPages} else r.requests_made end)
          filter (where r.started_at >= ${at('perMinute')}::timestamptz), 0)::int as "perMinute",
        coalesce(sum(case when r.status = 'RUNNING' then ${maxPages} else r.requests_made end)
          filter (where r.started_at >= ${at('perDay')}::timestamptz), 0)::int as "perDay",
        coalesce(sum(case when r.status = 'RUNNING' then ${maxPages} else r.requests_made end)
          filter (where r.started_at >= ${at('perWeek')}::timestamptz), 0)::int as "perWeek",
        coalesce(sum(case when r.status = 'RUNNING' then ${maxPages} else r.requests_made end), 0)::int as "perMonth"
      from scan_runs r join job_sources s on s.id = r.source_id
      where s.adapter = 'adzuna' and r.started_at >= ${at('perMonth')}::timestamptz`);
    return checkQuota(
      row ?? { perMinute: 0, perDay: 0, perWeek: 0, perMonth: 0 },
      {
        perMinute: this.env.ADZUNA_LIMIT_PER_MINUTE,
        perDay: this.env.ADZUNA_LIMIT_PER_DAY,
        perWeek: this.env.ADZUNA_LIMIT_PER_WEEK,
        perMonth: this.env.ADZUNA_LIMIT_PER_MONTH,
      },
      maxPages,
      this.env.SOURCE_QUOTA_SAFETY,
    );
  }

  private async markSuccess(
    source: SourceRow,
    startedAt: Date,
    cursor: string | null,
  ): Promise<void> {
    const interval = this.intervalSec(source, await this.boardBand(source));
    await this.db
      .update(jobSources)
      .set({
        lastSuccessfulScan: startedAt,
        lastAttemptedScan: startedAt,
        lastCursor: cursor,
        lastError: null,
        consecutiveFailures: 0,
        // A manual scan of an auto-paused source must not resume it as a side effect (D103).
        status: sql`case when ${jobSources.status} = 'PAUSED_AUTO' then ${jobSources.status} else 'ACTIVE' end`,
        leaseUntil: null,
        manualRequestedAt: null,
        nextScanAt: sql`now() + (${interval} * interval '1 second')`,
      })
      .where(eq(jobSources.id, source.id));
  }

  /** Backoff table from docs 06 §7; blocked sources disable themselves after 3 strikes. */
  private async markFailure(source: SourceRow, error: string, blocked: boolean): Promise<void> {
    const failures = source.consecutiveFailures + 1;
    const interval = this.intervalSec(source);
    let delaySec: number;
    let status: SourceRow['status'];
    if (failures <= 2) {
      delaySec = interval * 2;
      status = 'DEGRADED';
    } else if (failures <= 5) {
      delaySec = 3600 * 2 ** (failures - 3); // 2h, 4h, 8h
      status = 'FAILING';
    } else {
      delaySec = 24 * 3600;
      status = 'FAILING';
    }
    if (blocked && failures >= 3) status = 'DISABLED';
    await this.db
      .update(jobSources)
      .set({
        lastAttemptedScan: new Date(),
        lastError: error.slice(0, 500),
        consecutiveFailures: failures,
        status,
        enabled: status === 'DISABLED' ? false : source.enabled,
        leaseUntil: null,
        manualRequestedAt: null,
        nextScanAt: sql`now() + (${delaySec} * interval '1 second')`,
      })
      .where(eq(jobSources.id, source.id));
    if (status === 'DISABLED')
      this.logger.error(`${source.name} disabled after repeated blocks (${error})`);
  }

  private countingHttp(onRequest: () => void): HttpClientPort {
    const inner = this.http;
    return {
      request: (url, opts) => {
        onRequest();
        return inner.request(url, opts);
      },
      getJson: (url, opts) => {
        onRequest();
        return inner.getJson(url, opts);
      },
    };
  }
}

function bump(
  counts: { new: number; updated: number; attached: number },
  outcome: DedupeOutcome,
): void {
  if (outcome === 'NEW') counts.new++;
  else if (outcome === 'UPDATED') counts.updated++;
  else if (outcome === 'ATTACHED') counts.attached++;
}
