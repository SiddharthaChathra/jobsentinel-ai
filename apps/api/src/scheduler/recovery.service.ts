import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Env } from '@jobsentinel/config';
import { ENV } from '../common/config/config.module';
import { DB, type Db } from '../common/db/db.module';
import { AuditLogger } from '../system/audit-logger';

export interface SweepResult {
  orphanedRuns: number;
  expiredLeases: number;
  stuckValidating: number;
  unscheduled: number;
}

/**
 * Cheap per-tick sweep (docs 07 §2.3): a crashed worker leaves RUNNING scan_runs and live
 * leases behind; none of that must ever block the next tick or lose a job.
 */
@Injectable()
export class RecoveryService {
  private readonly logger = new Logger(RecoveryService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditLogger,
  ) {}

  async sweep(): Promise<SweepResult> {
    const timeoutMs = this.env.SOURCE_SCAN_TIMEOUT_MS * 2;

    // 1. scan_runs still RUNNING long after their timeout → FAILED('orphaned'); cursor untouched.
    const orphaned = await this.db.execute<{ id: string }>(sql`
      update scan_runs set status = 'FAILED', completed_at = now(), error_message = 'orphaned: worker did not complete this run'
      where status = 'RUNNING' and started_at < now() - (${timeoutMs} * interval '1 millisecond')
      returning id`);

    // 2. Expired leases → cleared so the source is due again.
    const leases = await this.db.execute<{ id: string }>(sql`
      update job_sources set lease_until = null where lease_until is not null and lease_until < now() returning id`);

    // 3. Jobs stuck in VALIDATING for > 30 min (stage crashed mid-way) → back to CLASSIFIED (Phase 6 stage).
    const stuck = await this.db.execute<{ id: string }>(sql`
      update jobs set status = 'CLASSIFIED', stage_error = 'recovered from stuck VALIDATING'
      where status = 'VALIDATING' and updated_at < now() - interval '30 minutes' returning id`);

    // 4. Enabled sources with no schedule at all → due now.
    const unscheduled = await this.db.execute<{ id: string }>(sql`
      update job_sources set next_scan_at = now() where enabled and next_scan_at is null returning id`);

    const result = {
      orphanedRuns: orphaned.length,
      expiredLeases: leases.length,
      stuckValidating: stuck.length,
      unscheduled: unscheduled.length,
    };
    if (Object.values(result).some((n) => n > 0)) {
      this.logger.warn(`recovery sweep: ${JSON.stringify(result)}`);
      await this.audit.event('WORKER', 'recovery sweep repaired state', result, { level: 'WARN' });
    }
    return result;
  }
}
