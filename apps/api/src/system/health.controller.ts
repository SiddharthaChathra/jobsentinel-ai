import { Controller, Get, Inject, Res } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Response } from 'express';
import type { HealthResponse, ReadinessResponse } from '@jobsentinel/types';
import { DB, type Db } from '../common/db/db.module';
import { Public } from '../common/decorators/public.decorator';
import { APP_VERSION } from '../version';

/**
 * Liveness/readiness endpoints — the only unauthenticated routes (docs 03 §2).
 * These are outside the /api/v1 prefix and are not enveloped (EnvelopeInterceptor skips /health*).
 */
@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

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
}
