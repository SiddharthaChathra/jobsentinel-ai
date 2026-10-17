import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { SCAN_INTERVAL_SEC } from '@jobsentinel/config';
import {
  SourceInput,
  SourcePatch,
  SourceReportQuery,
  type SourceReport,
  type SourceStatus,
  type AdapterInfo,
  type ScanRun,
  type SourceSummary,
  type SourceValidationResult,
} from '@jobsentinel/types';
import { AdminGuard } from '../auth/admin.guard';
import { DB, type Db } from '../common/db/db.module';
import { companies, jobSourceMappings, jobSources, scanRuns } from '../common/db/schema';
import { AppError } from '../common/errors/app-error';
import { HTTP_CLIENT } from '../common/http/http.module';
import type { HttpClientPort } from '../common/http/http-client';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { SchedulerService } from '../scheduler/scheduler.service';
import { SourceRegistry } from './source-registry';
import { SourceReportService } from './source-report.service';

const IdParam = z.string().uuid();
const RunsQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

/** Admin-only source management (docs 03 §2 "Sources"). Scans never run inline — they are queued for the worker. */
@Controller('sources')
@UseGuards(AdminGuard)
export class SourcesController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(HTTP_CLIENT) private readonly http: HttpClientPort,
    private readonly registry: SourceRegistry,
    private readonly scheduler: SchedulerService,
    private readonly report: SourceReportService,
  ) {}

  /** Report card: collected vs kept per source over 7 or 30 days (F2, D103; docs 03). */
  @Get('report')
  sourceReport(
    @Query(new ZodValidationPipe(SourceReportQuery)) query: SourceReportQuery,
  ): Promise<SourceReport> {
    return this.report.report(query.days === 7 ? 7 : 30);
  }

  /** One-click resume of an auto-paused source; scanned on the next tick (F2, D103). */
  @Post(':id/resume')
  @HttpCode(200)
  resume(
    @Param('id', new ZodValidationPipe(IdParam)) id: string,
  ): Promise<{ id: string; status: SourceStatus }> {
    return this.report.resume(id);
  }

  @Get('adapters')
  adapters(): AdapterInfo[] {
    return this.registry.list().map((a) => ({
      adapter: a.metadata.adapter,
      label: a.metadata.label,
      type: a.metadata.type,
      docsUrl: a.metadata.docsUrl,
      defaultPriority: a.metadata.defaultPriority,
      minIntervalSec: a.metadata.minIntervalSec,
      configSchema: z.toJSONSchema(a.configSchema),
    }));
  }

  @Get()
  async list(): Promise<SourceSummary[]> {
    const rows = await this.db
      .select({
        source: jobSources,
        companyName: companies.name,
        jobsCount: sql<number>`(select count(*) from ${jobSourceMappings} m where m.source_id = ${jobSources.id})`,
      })
      .from(jobSources)
      .leftJoin(companies, eq(companies.id, jobSources.companyId))
      .orderBy(jobSources.priority, jobSources.name);
    return rows.map((r) => toSummary(r.source, r.companyName, Number(r.jobsCount)));
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(SourceInput)) body: SourceInput,
  ): Promise<SourceSummary> {
    const adapter = this.registry.get(body.adapter);
    if (!adapter) throw AppError.unprocessable('UNKNOWN_ADAPTER', `No adapter "${body.adapter}"`);
    const parsed = adapter.configSchema.safeParse(body.config);
    if (!parsed.success)
      throw AppError.unprocessable(
        'INVALID_SOURCE_CONFIG',
        'Config does not match the adapter schema',
        parsed.error.issues,
      );
    if (body.scanIntervalSec && body.scanIntervalSec < adapter.metadata.minIntervalSec) {
      throw AppError.unprocessable(
        'INTERVAL_TOO_SHORT',
        `This adapter allows at most one scan every ${adapter.metadata.minIntervalSec} s`,
      );
    }
    const validation = await adapter.validateSource(parsed.data, this.http);
    if (!validation.ok) throw AppError.unprocessable('SOURCE_UNREACHABLE', validation.message);
    const [row] = await this.db
      .insert(jobSources)
      .values({
        name: body.name,
        type: adapter.metadata.type,
        adapter: body.adapter,
        config: parsed.data,
        companyId: body.companyId ?? null,
        enabled: body.enabled,
        priority: body.priority,
        scanIntervalSec: body.scanIntervalSec ?? SCAN_INTERVAL_SEC[body.priority],
        nextScanAt: new Date(),
      })
      .returning();
    return toSummary(row!, null, 0);
  }

  @Patch(':id')
  async patch(
    @Param('id', new ZodValidationPipe(IdParam)) id: string,
    @Body(new ZodValidationPipe(SourcePatch)) body: SourcePatch,
  ): Promise<SourceSummary> {
    const existing = await this.db.query.jobSources.findFirst({ where: eq(jobSources.id, id) });
    if (!existing) throw AppError.notFound('SOURCE_NOT_FOUND');
    const adapter = this.registry.get(existing.adapter);
    if (body.config && adapter) {
      const parsed = adapter.configSchema.safeParse(body.config);
      if (!parsed.success)
        throw AppError.unprocessable(
          'INVALID_SOURCE_CONFIG',
          'Config does not match the adapter schema',
          parsed.error.issues,
        );
    }
    if (body.scanIntervalSec && adapter && body.scanIntervalSec < adapter.metadata.minIntervalSec) {
      throw AppError.unprocessable(
        'INTERVAL_TOO_SHORT',
        `This adapter allows at most one scan every ${adapter.metadata.minIntervalSec} s`,
      );
    }
    const reEnabling = body.enabled === true && !existing.enabled;
    const [row] = await this.db
      .update(jobSources)
      .set({
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.priority ? { priority: body.priority } : {}),
        ...(body.scanIntervalSec !== undefined ? { scanIntervalSec: body.scanIntervalSec } : {}),
        ...(body.config ? { config: body.config } : {}),
        // Re-enabling a disabled/failing source gives it a clean slate.
        ...(reEnabling
          ? {
              status: 'ACTIVE' as const,
              consecutiveFailures: 0,
              lastError: null,
              nextScanAt: new Date(),
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(jobSources.id, id))
      .returning();
    const company = row!.companyId
      ? await this.db.query.companies.findFirst({ where: eq(companies.id, row!.companyId) })
      : null;
    return toSummary(
      row!,
      company?.name ?? null,
      await this.db.$count(jobSourceMappings, eq(jobSourceMappings.sourceId, id)),
    );
  }

  @Post(':id/scan')
  @HttpCode(202)
  async scan(@Param('id', new ZodValidationPipe(IdParam)) id: string): Promise<{ queued: true }> {
    const existing = await this.db.query.jobSources.findFirst({ where: eq(jobSources.id, id) });
    if (!existing) throw AppError.notFound('SOURCE_NOT_FOUND');
    if (!existing.enabled) throw AppError.conflict('SOURCE_DISABLED', 'Enable the source first');
    await this.scheduler.requestManualScan(id);
    return { queued: true };
  }

  @Post(':id/validate')
  @HttpCode(200)
  async validate(
    @Param('id', new ZodValidationPipe(IdParam)) id: string,
  ): Promise<SourceValidationResult> {
    const existing = await this.db.query.jobSources.findFirst({ where: eq(jobSources.id, id) });
    if (!existing) throw AppError.notFound('SOURCE_NOT_FOUND');
    const adapter = this.registry.get(existing.adapter);
    if (!adapter) return { ok: false, message: `No adapter "${existing.adapter}"` };
    const parsed = adapter.configSchema.safeParse(existing.config);
    if (!parsed.success) return { ok: false, message: 'Stored config is invalid for this adapter' };
    try {
      return await adapter.validateSource(parsed.data, this.http);
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  @Get(':id/scan-runs')
  async runs(
    @Param('id', new ZodValidationPipe(IdParam)) id: string,
    @Query(new ZodValidationPipe(RunsQuery)) q: z.infer<typeof RunsQuery>,
  ): Promise<ScanRun[]> {
    const rows = await this.db
      .select()
      .from(scanRuns)
      .where(eq(scanRuns.sourceId, id))
      .orderBy(desc(scanRuns.startedAt))
      .limit(q.limit);
    return rows.map((r) => toScanRun(r));
  }
}

export function toSummary(
  s: typeof jobSources.$inferSelect,
  companyName: string | null,
  jobsCount: number,
): SourceSummary {
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    adapter: s.adapter,
    config: (s.config ?? {}) as Record<string, unknown>,
    company: s.companyId && companyName ? { id: s.companyId, name: companyName } : null,
    enabled: s.enabled,
    priority: s.priority,
    scanIntervalSec: s.scanIntervalSec,
    status: s.status,
    nextScanAt: s.nextScanAt?.toISOString() ?? null,
    lastAttemptedScan: s.lastAttemptedScan?.toISOString() ?? null,
    lastSuccessfulScan: s.lastSuccessfulScan?.toISOString() ?? null,
    lastError: s.lastError,
    consecutiveFailures: s.consecutiveFailures,
    leased: s.leaseUntil !== null && s.leaseUntil.getTime() > Date.now(),
    manualRequested: s.manualRequestedAt !== null,
    jobsCount,
  };
}

export function toScanRun(r: typeof scanRuns.$inferSelect, sourceName?: string): ScanRun {
  return {
    id: r.id,
    sourceId: r.sourceId,
    sourceName,
    trigger: r.trigger,
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    jobsFound: r.jobsFound,
    jobsNew: r.jobsNew,
    jobsUpdated: r.jobsUpdated,
    jobsSkipped: r.jobsSkipped,
    requestsMade: r.requestsMade,
    durationMs: r.durationMs,
    errorMessage: r.errorMessage,
  };
}
