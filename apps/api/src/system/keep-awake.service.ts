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

/** Under Render's 15-minute idle limit, with room for a slow or failed request. */
export const KEEP_AWAKE_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Whether `at` falls inside `hours` ("start-end", local to `tz`, end exclusive). A window may wrap
 * past midnight ("22-6"); "0-24" is always. Equal ends mean never.
 */
export function withinAwakeHours(at: Date, hours: string, tz: string): boolean {
  const [start, end] = hours.split('-').map(Number) as [number, number];
  const hour =
    Number(
      new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: tz }).format(
        at,
      ),
    ) % 24;
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

/**
 * Keeps a free Render instance from sleeping by requesting its own public `/health` (D94).
 *
 * A sleeping instance makes the next visitor wait 30-60 s. The first fix was a GitHub Actions
 * job pinging every 10 minutes, but GitHub runs free scheduled jobs best-effort: it fired 4 times
 * in 12 hours. A request to the service's own public URL goes out through Render's proxy and back
 * in, so it counts as inbound traffic, and a timer inside the process cannot be skipped.
 *
 * Pings only within `KEEP_AWAKE_HOURS` (default all day): every free Render service in a workspace
 * shares 750 hours a month, and a 24/7 API alone uses ~744 (D99). A sleeping process cannot wake
 * itself when the window opens: the first visitor, a Telegram message or the GitHub keep-warm job
 * (scheduled for the same hours) does, and from then on this timer holds it awake.
 *
 * Active only when Render sets `RENDER_EXTERNAL_URL`; locally, in tests and in the worker it does
 * nothing. Failures are logged, never thrown: a missed ping costs at most one cold start.
 */
@Injectable()
export class KeepAwakeService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(KeepAwakeService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(HTTP_CLIENT) private readonly http: HttpClientPort,
  ) {}

  onApplicationBootstrap(): void {
    const base = this.env.RENDER_EXTERNAL_URL;
    if (!base) return;
    const url = `${base.replace(/\/$/, '')}/health`;
    const hours = this.env.KEEP_AWAKE_HOURS;
    const tz = this.env.KEEP_AWAKE_TZ;
    this.timer = setInterval(() => {
      // Outside the window the instance is left to sleep after Render's 15 idle minutes (D99).
      if (withinAwakeHours(new Date(), hours, tz)) void this.ping(url);
    }, KEEP_AWAKE_INTERVAL_MS);
    // The process must still be able to exit on shutdown while the timer is pending.
    this.timer.unref();
    this.logger.log(
      `keep-awake: pinging ${url} every ${KEEP_AWAKE_INTERVAL_MS / 60_000} min, ${hours} h ${tz}`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async ping(url: string): Promise<void> {
    try {
      const res = await this.http.request(url, { retries: 0, timeoutMs: 30_000 });
      if (!res.ok) this.logger.warn(`keep-awake: ${url} answered ${res.status}`);
    } catch (err) {
      this.logger.warn(
        `keep-awake: ${url} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
