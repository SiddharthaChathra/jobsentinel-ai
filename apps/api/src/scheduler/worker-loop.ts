import { Inject, Injectable } from '@nestjs/common';
import type { Env } from '@jobsentinel/config';
import type { Logger } from 'pino';
import { ENV } from '../common/config/config.module';

export interface WorkerOptions {
  /** Run one tick and exit — used by cron-style hosts (docs 07 §1.1, 14 §1). */
  once: boolean;
  logger: Logger;
}

/**
 * The worker's main loop. In Phase 1 a tick only logs a heartbeat; scan/pipeline/notification
 * stages are plugged in here in Phases 4–9. Each stage must be wrapped so a failure never
 * escapes the loop (docs 05 §4).
 */
@Injectable()
export class WorkerLoop {
  private stopping = false;

  constructor(@Inject(ENV) private readonly env: Env) {}

  stop(): void {
    this.stopping = true;
  }

  async run(opts: WorkerOptions): Promise<void> {
    const { logger } = opts;
    do {
      const startedAt = Date.now();
      try {
        await this.tick(logger);
        logger.info({ durationMs: Date.now() - startedAt }, 'tick complete');
      } catch (err) {
        // tick() already isolates stages; this guards against bugs in the loop itself
        logger.error({ err }, 'tick failed; loop continues');
      }
      if (opts.once) break;
      await sleep(jitter(this.env.WORKER_TICK_MS));
    } while (!this.stopping);
    logger.info('worker loop exited');
  }

  private async tick(logger: Logger): Promise<void> {
    const stages: Array<[string, () => Promise<void> | void]> = [
      ['heartbeat', () => logger.debug('heartbeat')],
    ];
    for (const [name, stage] of stages) {
      try {
        await stage();
      } catch (err) {
        logger.error({ err, stage: name }, 'stage failed; continuing');
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ±10 % jitter so several workers/hosts never align exactly. */
function jitter(ms: number): number {
  return Math.round(ms * (0.9 + Math.random() * 0.2));
}
