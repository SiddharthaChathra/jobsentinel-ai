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
import { NotificationsService } from './notifications.service';
import { WATCHED_WORKFLOWS, workflowProblem, type WorkflowState } from './workflow-watch';

const CHECK_EVERY_MS = 12 * 3_600_000;
const FIRST_CHECK_MS = 5 * 60_000;

/**
 * Watches the GitHub workflows that nothing else watches (D125): the weekly backup and the uptime
 * check. GitHub disables a public repository's scheduled workflows after 60 days without
 * activity, and a scheduled job cannot report its own silence — so the API, which runs every day,
 * checks them twice a day and alerts the admins (at most once a day per workflow) when one is
 * disabled or has not run for 10 days. A workflow disabled for inactivity is re-enabled with the
 * dispatch token the API already holds (Actions: read and write on this repository).
 *
 * Active only where `WORKER_DISPATCH_TOKEN` is set, i.e. the API on Render — not the GitHub-hosted
 * worker, which imports this module too.
 */
@Injectable()
export class WorkflowWatchService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowWatchService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(HTTP_CLIENT) private readonly http: HttpClientPort,
    private readonly notifications: NotificationsService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.WORKER_DISPATCH_TOKEN) return;
    const first = setTimeout(() => void this.check(), FIRST_CHECK_MS);
    const every = setInterval(() => void this.check(), CHECK_EVERY_MS);
    first.unref();
    every.unref();
    this.timers = [first, every];
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  /** Returns what it found, for the logs and tests; never throws. */
  async check(
    now = new Date(),
  ): Promise<{ file: string; problem: string | null; reenabled: boolean }[]> {
    const results: { file: string; problem: string | null; reenabled: boolean }[] = [];
    for (const wf of WATCHED_WORKFLOWS) {
      try {
        const state = await this.read(wf.file);
        const problem = workflowProblem(state, now);
        let reenabled = false;
        if (state.state === 'disabled_inactivity') reenabled = await this.enable(wf.file);
        results.push({ file: wf.file, problem, reenabled });
        if (!problem) continue;
        this.logger.warn(
          `workflow-watch: ${wf.file}: ${problem}${reenabled ? ' (re-enabled)' : ''}`,
        );
        const detail =
          `${wf.label} (${wf.file}): ${problem}.` +
          (reenabled
            ? ' It was disabled for inactivity and has been re-enabled automatically; check it runs.'
            : ` Open https://github.com/${this.env.WORKER_DISPATCH_REPO}/actions/workflows/${wf.file} and run it, or enable it.`) +
          ' See docs/owner-tasks.md.';
        for (const adminId of await this.notifications.adminIds()) {
          await this.notifications.enqueueSystemAlert(
            adminId,
            `workflow-stale:${wf.file}`,
            `GitHub workflow needs attention: ${wf.label}`,
            detail,
            24,
          );
        }
      } catch (err) {
        this.logger.warn(
          `workflow-watch: ${wf.file}: check failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        results.push({ file: wf.file, problem: null, reenabled: false });
      }
    }
    return results;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.env.WORKER_DISPATCH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private async read(file: string): Promise<WorkflowState> {
    const base = `https://api.github.com/repos/${this.env.WORKER_DISPATCH_REPO}/actions/workflows/${file}`;
    const opts = { headers: this.headers(), timeoutMs: 20_000, retries: 1 };
    const { data: wf } = await this.http.getJson<{ state?: string }>(base, opts);
    const { data: runs } = await this.http.getJson<{ workflow_runs?: { created_at?: string }[] }>(
      `${base}/runs?per_page=1`,
      opts,
    );
    const at = runs.workflow_runs?.[0]?.created_at;
    return { state: wf.state ?? 'unknown', lastRunAt: at ? new Date(at) : null };
  }

  private async enable(file: string): Promise<boolean> {
    const url = `https://api.github.com/repos/${this.env.WORKER_DISPATCH_REPO}/actions/workflows/${file}/enable`;
    try {
      const res = await this.http.request(url, {
        method: 'PUT',
        headers: this.headers(),
        timeoutMs: 20_000,
        retries: 1,
      });
      return res.status === 204;
    } catch {
      return false;
    }
  }
}
