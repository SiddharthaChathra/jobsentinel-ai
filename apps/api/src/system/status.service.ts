import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import type { SystemStatus } from '@jobsentinel/types';
import { AI_BUDGET } from '../common/ai/ai.module';
import type { DbBudget } from '../common/ai/db-ai';
import { DB, type Db } from '../common/db/db.module';
import { companies, jobSources, jobs, scanRuns, workerHeartbeats } from '../common/db/schema';
import { toScanRun } from '../sources/sources.controller';

/** Worker considered alive if any heartbeat is younger than this. */
const ALIVE_WINDOW_MS = 10 * 60_000;

@Injectable()
export class StatusService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AI_BUDGET) private readonly budget: DbBudget,
  ) {}

  async snapshot(): Promise<SystemStatus> {
    const aiUsage = await this.budget.usage();
    const [beat] = await this.db
      .select()
      .from(workerHeartbeats)
      .orderBy(desc(workerHeartbeats.lastBeatAt))
      .limit(1);
    const sourceRows = await this.db
      .select({
        status: jobSources.status,
        enabled: jobSources.enabled,
        nextScanAt: jobSources.nextScanAt,
      })
      .from(jobSources);
    const lastScans = await this.db
      .select({ run: scanRuns, sourceName: jobSources.name })
      .from(scanRuns)
      .innerJoin(jobSources, eq(jobSources.id, scanRuns.sourceId))
      .orderBy(desc(scanRuns.startedAt))
      .limit(10);
    const pipelineRows = await this.db
      .select({ status: jobs.status, n: sql<number>`count(*)` })
      .from(jobs)
      .groupBy(jobs.status);
    const [last24] = await this.db
      .select({
        found: sql<number>`coalesce(sum(${scanRuns.jobsFound}), 0)`,
        new: sql<number>`coalesce(sum(${scanRuns.jobsNew}), 0)`,
      })
      .from(scanRuns)
      .where(sql`${scanRuns.startedAt} > now() - interval '24 hours'`);
    const [totals] = await this.db
      .select({
        jobs: sql<number>`(select count(*) from ${jobs})`,
        companies: sql<number>`(select count(*) from ${companies})`,
      })
      .from(sql`(select 1) as one`);

    const enabled = sourceRows.filter((s) => s.enabled);
    const nextScan = enabled
      .map((s) => s.nextScanAt)
      .filter((d): d is Date => Boolean(d))
      .sort((a, b) => a.getTime() - b.getTime())[0];
    return {
      worker: {
        alive: Boolean(beat && Date.now() - beat.lastBeatAt.getTime() < ALIVE_WINDOW_MS),
        lastBeatAt: beat?.lastBeatAt.toISOString() ?? null,
        hostname: beat?.hostname ?? null,
        version: beat?.version ?? null,
        currentTask: beat?.currentTask ?? null,
      },
      sources: {
        total: sourceRows.length,
        active: enabled.filter((s) => s.status === 'ACTIVE').length,
        degraded: enabled.filter((s) => s.status === 'DEGRADED').length,
        failing: enabled.filter((s) => s.status === 'FAILING').length,
        disabled: sourceRows.filter((s) => !s.enabled || s.status === 'DISABLED').length,
        nextScanAt: nextScan?.toISOString() ?? null,
      },
      lastScans: lastScans.map((r) => toScanRun(r.run, r.sourceName)),
      pipeline: Object.fromEntries(pipelineRows.map((r) => [r.status, Number(r.n)])),
      jobsLast24h: { found: Number(last24?.found ?? 0), new: Number(last24?.new ?? 0) },
      totals: { jobs: Number(totals?.jobs ?? 0), companies: Number(totals?.companies ?? 0) },
      ai: {
        callsToday: aiUsage.calls,
        callBudget: aiUsage.callBudget,
        tokensToday: aiUsage.tokens,
        tokenBudget: aiUsage.tokenBudget,
        byPurpose: aiUsage.byPurpose,
        userCallLimit: aiUsage.userCallLimit,
      },
    };
  }
}
