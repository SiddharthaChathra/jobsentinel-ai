import { Controller, Get } from '@nestjs/common';
import type { HealthResponse, ReadinessResponse } from '@jobsentinel/types';
import { APP_VERSION } from '../version';

/**
 * Liveness/readiness endpoints — the only unauthenticated routes (docs 03 §2).
 * Readiness gains a DB check in Phase 3.
 */
@Controller('health')
export class HealthController {
  @Get()
  health(): HealthResponse {
    return { status: 'ok', version: APP_VERSION, uptimeSec: Math.round(process.uptime()) };
  }

  @Get('ready')
  ready(): ReadinessResponse {
    return { status: 'ok', checks: { db: 'skipped' } };
  }
}
