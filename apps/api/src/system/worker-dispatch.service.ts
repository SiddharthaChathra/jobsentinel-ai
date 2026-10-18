import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Env } from '@jobsentinel/config';
import { sql } from 'drizzle-orm';
import { ENV } from '../common/config/config.module';
import { DB, type Db } from '../common/db/db.module';
import { HTTP_CLIENT } from '../common/http/http.module';
import type { HttpClientPort } from '../common/http/http-client';

/** How long after boot the catch-up check runs: past start-up, before the first interval. */
export const CATCH_UP_DELAY_MS = 60_000;

/** The worker is overdue when it has not beaten for longer than one dispatch interval. */
export function isOverdue(lastBeatAt: Date | null, now: Date, intervalMin: number): boolean {
  return !lastBeatAt || now.getTime() - lastBeatAt.getTime() > intervalMin * 60_000;
}

/**
 * Starts the GitHub-hosted worker on a dependable clock (D95).
 *
 * The worker workflow is scheduled every 30 minutes, but GitHub runs free scheduled jobs
 * best-effort and actually ran it every 3-5 hours, so new postings waited hours to be scanned.
 * The API is awake around the clock (D94), so it keeps the time instead and asks GitHub to run the
 * workflow through `workflow_dispatch`; GitHub still does the work on its own runners. The
 * workflow's concurrency group queues a run that overlaps the schedule rather than doubling it.
 *
 * Active only when `WORKER_DISPATCH_TOKEN` is set — a fine-grained token limited to Actions on
 * this one repository. Failures are logged, never thrown: the GitHub schedule remains a backup.
 */
@Injectable()
export class WorkerDispatchService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WorkerDispatchService.name);
  private timer: NodeJS.Timeout | null = null;
  private catchUpTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(HTTP_CLIENT) private readonly http: HttpClientPort,
    @Optional() @Inject(DB) private readonly db?: Db,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.WORKER_DISPATCH_TOKEN) return;
    const everyMs = this.env.WORKER_DISPATCH_INTERVAL_MIN * 60_000;
    this.timer = setInterval(() => void this.dispatch(), everyMs);
    this.timer.unref();
    // Every restart (a deploy, a wake from sleep) restarts the interval, so a run of deploys less
    // than an interval apart once kept the worker from running for 75 minutes (D124). A minute
    // after boot, run it now if the last heartbeat is already older than one interval.
    this.catchUpTimer = setTimeout(() => void this.catchUp(), CATCH_UP_DELAY_MS);
    this.catchUpTimer.unref();
    this.logger.log(
      `worker-dispatch: starting ${this.env.WORKER_DISPATCH_REPO} worker.yml every ${this.env.WORKER_DISPATCH_INTERVAL_MIN} min`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.catchUpTimer) clearTimeout(this.catchUpTimer);
    this.timer = null;
    this.catchUpTimer = null;
  }

  /** Dispatches at once when the worker has been quiet for longer than one interval. */
  async catchUp(now = new Date()): Promise<boolean> {
    if (!this.db) return false;
    try {
      const [row] = await this.db.execute<{ at: string | Date | null }>(
        sql`select max(last_beat_at) as at from worker_heartbeats`,
      );
      const last = row?.at ? new Date(row.at) : null;
      if (!isOverdue(last, now, this.env.WORKER_DISPATCH_INTERVAL_MIN)) return false;
      this.logger.log(
        `worker-dispatch: last heartbeat ${last ? `${Math.round((now.getTime() - last.getTime()) / 60_000)} min ago` : 'never'}; running the worker now`,
      );
      return await this.dispatch();
    } catch (err) {
      this.logger.warn(
        `worker-dispatch: catch-up check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  async dispatch(): Promise<boolean> {
    const token = this.env.WORKER_DISPATCH_TOKEN;
    if (!token) return false;
    const url = `https://api.github.com/repos/${this.env.WORKER_DISPATCH_REPO}/actions/workflows/worker.yml/dispatches`;
    try {
      const res = await this.http.request(url, {
        method: 'POST',
        retries: 1,
        timeoutMs: 20_000,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main' }),
      });
      if (res.status === 204) {
        this.logger.log('worker-dispatch: worker run requested');
        return true;
      }
      // 401/403/404 mean the token is wrong, expired or lacks Actions write on this repository.
      this.logger.warn(
        `worker-dispatch: GitHub answered ${res.status}${res.status === 401 || res.status === 403 || res.status === 404 ? ' — check WORKER_DISPATCH_TOKEN (Actions: read and write on this repository)' : ''}`,
      );
    } catch (err) {
      this.logger.warn(
        `worker-dispatch: request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return false;
  }
}
