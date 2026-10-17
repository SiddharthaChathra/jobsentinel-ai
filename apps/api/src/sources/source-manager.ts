import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { ScanTrigger } from '@jobsentinel/types';
import { SCAN_INTERVAL_SEC, type Env } from '@jobsentinel/config';
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
import { SourceRegistry } from './source-registry';

export type SourceRow = typeof jobSources.$inferSelect;

export interface ScanSummary {
  scanRunId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT';
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
  ) {}

  async runScan(source: SourceRow, trigger: ScanTrigger): Promise<ScanSummary> {
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

    const finish = async (status: ScanSummary['status'], error?: string): Promise<ScanSummary> => {
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
  private async markSuccess(
    source: SourceRow,
    startedAt: Date,
    cursor: string | null,
  ): Promise<void> {
    const interval = source.scanIntervalSec ?? SCAN_INTERVAL_SEC[source.priority];
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
    const interval = source.scanIntervalSec ?? SCAN_INTERVAL_SEC[source.priority];
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
