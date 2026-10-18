import { Controller, Get, Inject, Res } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Response } from 'express';
import type { Env } from '@jobsentinel/config';
import type { HealthResponse, ReadinessResponse, WorkerHealthResponse } from '@jobsentinel/types';
import { ENV } from '../common/config/config.module';
import { DB, type Db } from '../common/db/db.module';
import { Public } from '../common/decorators/public.decorator';
import { APP_VERSION } from '../version';
import { workerHealth } from './worker-health';

/**
 * Liveness/readiness endpoints — the only unauthenticated routes (docs 03 §2).
 * These are outside the /api/v1 prefix and are not enveloped (EnvelopeInterceptor skips /health*).
 */
@Public()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  health(): HealthResponse {
    return { status: 'ok', version: APP_VERSION, uptimeSec: Math.round(process.uptime()) };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadinessResponse> {
    let db: ReadinessResponse['checks'][string] = 'ok';
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      db = 'fail';
    }
    const status = db === 'ok' ? 'ok' : 'degraded';
    res.status(status === 'ok' ? 200 : 503);
    return { status, checks: { db } };
  }

  /**
   * Is the worker alive (F11, D124)? 503 when its last heartbeat is older than 2× the dispatch
   * interval inside the active hours; for the uptime check, which alerts on a non-2xx answer.
   */
  @Get('worker')
  async worker(@Res({ passthrough: true }) res: Response): Promise<WorkerHealthResponse> {
    const [row] = await this.db.execute<{ at: string | Date | null }>(
      sql`select max(last_beat_at) as at from worker_heartbeats`,
    );
    const result = workerHealth({
      lastBeatAt: row?.at ? new Date(row.at) : null,
      now: new Date(),
      intervalMin: this.env.WORKER_DISPATCH_INTERVAL_MIN,
      hours: this.env.KEEP_AWAKE_HOURS,
      tz: this.env.KEEP_AWAKE_TZ,
    });
    res.status(result.status === 'unhealthy' ? 503 : 200);
    return result;
  }
}
