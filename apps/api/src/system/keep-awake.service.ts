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
 * Keeps a free Render instance from sleeping by requesting its own public `/health` (D94).
 *
 * A sleeping instance makes the next visitor wait 30-60 s. The first fix was a GitHub Actions
 * job pinging every 10 minutes, but GitHub runs free scheduled jobs best-effort: it fired 4 times
 * in 12 hours. A request to the service's own public URL goes out through Render's proxy and back
 * in, so it counts as inbound traffic, and a timer inside the process cannot be skipped.
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
    this.timer = setInterval(() => void this.ping(url), KEEP_AWAKE_INTERVAL_MS);
    // The process must still be able to exit on shutdown while the timer is pending.
    this.timer.unref();
    this.logger.log(`keep-awake: pinging ${url} every ${KEEP_AWAKE_INTERVAL_MS / 60_000} min`);
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
