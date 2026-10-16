import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Env } from '@jobsentinel/config';
import { ENV } from '../common/config/config.module';
import { HTTP_CLIENT } from '../common/http/http.module';
import type { HttpClientPort } from '../common/http/http-client';

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

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(HTTP_CLIENT) private readonly http: HttpClientPort,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.WORKER_DISPATCH_TOKEN) return;
    const everyMs = this.env.WORKER_DISPATCH_INTERVAL_MIN * 60_000;
    this.timer = setInterval(() => void this.dispatch(), everyMs);
    this.timer.unref();
    this.logger.log(
      `worker-dispatch: starting ${this.env.WORKER_DISPATCH_REPO} worker.yml every ${this.env.WORKER_DISPATCH_INTERVAL_MIN} min`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
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
