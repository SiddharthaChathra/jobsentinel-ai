import { hostname } from 'node:os';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB, type Db } from '../common/db/db.module';
import { workerHeartbeats } from '../common/db/schema';
import { AuditLogger } from '../system/audit-logger';
import { APP_VERSION } from '../version';

/** Heartbeat for System Status + daily retention (docs 02 §8). */
@Injectable()
export class HousekeepingService {
  private readonly logger = new Logger(HousekeepingService.name);
  private lastRetentionRun = 0;
  readonly workerId = `${hostname()}-${process.pid}`;
  private readonly startedAt = new Date();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditLogger,
  ) {}

  async heartbeat(currentTask: string | null, once: boolean): Promise<void> {
    await this.db
      .insert(workerHeartbeats)
      .values({
        workerId: this.workerId,
        hostname: hostname(),
        version: APP_VERSION,
        startedAt: this.startedAt,
        lastBeatAt: new Date(),
        currentTask,
        once: once ? 1 : 0,
      })
      .onConflictDoUpdate({
        target: workerHeartbeats.workerId,
        set: { lastBeatAt: new Date(), currentTask, version: APP_VERSION },
      });
  }

  /** Runs at most once per 24 h per process; `force` for --once hosts that never live that long. */
  async runRetention(force = false): Promise<void> {
    if (!force && Date.now() - this.lastRetentionRun < 24 * 3600_000) return;
    this.lastRetentionRun = Date.now();
    const scan = await this.db.execute(
      sql`delete from scan_runs where started_at < now() - interval '30 days'`,
    );
    const logs = await this.db.execute(
      sql`delete from system_logs where created_at < now() - interval '30 days'`,
    );
    const ai = await this.db.execute(
      sql`delete from ai_calls where created_at < now() - interval '60 days'`,
    );
    const payloads = await this.db.execute(sql`
      update job_source_mappings m set raw_payload = null
      from jobs j
      where m.job_id = j.id and m.raw_payload is not null and m.last_seen_at < now() - interval '30 days'
        and j.status in ('EXPIRED','REJECTED','FILTERED_OUT')`);
    const jobs = await this.db.execute(sql`
      delete from jobs j
      where j.status in ('EXPIRED','REJECTED','FILTERED_OUT')
        and j.updated_at < now() - interval '90 days'
        and not exists (select 1 from saved_jobs s where s.job_id = j.id)
        and not exists (select 1 from applications a where a.job_id = j.id)`);
    const beats = await this.db.execute(
      sql`delete from worker_heartbeats where last_beat_at < now() - interval '7 days'`,
    );
    const summary = {
      scanRuns: scan.length,
      systemLogs: logs.length,
      aiCalls: ai.length,
      payloadsNulled: payloads.length,
      jobsDeleted: jobs.length,
      staleHeartbeats: beats.length,
    };
    this.logger.log(`retention: ${JSON.stringify(summary)}`);
    await this.audit.event('HOUSEKEEPING', 'retention run', summary);
  }
}
