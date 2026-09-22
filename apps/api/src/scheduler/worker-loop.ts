import { Inject, Injectable } from '@nestjs/common';
import type { Env } from '@jobsentinel/config';
import type { Logger } from 'pino';
import { ENV } from '../common/config/config.module';
import { ClassificationService } from '../jobs/classification.service';
import { AuditLogger } from '../system/audit-logger';
import { HousekeepingService } from './housekeeping.service';
import { RecoveryService } from './recovery.service';
import { SchedulerService } from './scheduler.service';

export interface WorkerOptions {
  /** Run one tick and exit — used by cron-style hosts (docs 07 §1.1, 14 §1). */
  once: boolean;
  /** Restrict scanning to these source ids (ad-hoc runs from a laptop). */
  sourceIds?: string[];
  logger: Logger;
}

type Stage = { name: string; run: () => unknown };

/**
 * The worker's main loop (docs 05 §4). Every stage is isolated: a failure is logged and the
 * tick continues; the loop itself never throws. Pipeline stages (classify/validate/match/notify)
 * are appended here in Phases 5–9.
 */
@Injectable()
export class WorkerLoop {
  private stopping = false;
  private consecutiveTickFailures = 0;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly scheduler: SchedulerService,
    private readonly classification: ClassificationService,
    private readonly recovery: RecoveryService,
    private readonly housekeeping: HousekeepingService,
    private readonly audit: AuditLogger,
  ) {}

  stop(): void {
    this.stopping = true;
  }

  async run(opts: WorkerOptions): Promise<void> {
    const { logger } = opts;
    await this.audit.event('WORKER', 'worker started', {
      workerId: this.housekeeping.workerId,
      once: opts.once,
    });
    do {
      const startedAt = Date.now();
      try {
        await this.tick(opts);
        this.consecutiveTickFailures = 0;
        logger.info({ durationMs: Date.now() - startedAt }, 'tick complete');
      } catch (err) {
        // tick() already isolates stages; this guards against bugs in the loop itself
        this.consecutiveTickFailures++;
        logger.error(
          { err, consecutive: this.consecutiveTickFailures },
          'tick failed; loop continues',
        );
        if (this.consecutiveTickFailures === 5)
          await this.audit.event(
            'WORKER',
            'five consecutive tick failures',
            {},
            { level: 'ERROR' },
          );
      }
      if (opts.once) break;
      await sleep(jitter(this.env.WORKER_TICK_MS));
    } while (!this.stopping);
    await this.audit.event('WORKER', 'worker stopped', { workerId: this.housekeeping.workerId });
    logger.info('worker loop exited');
  }

  private async tick(opts: WorkerOptions): Promise<void> {
    const { logger } = opts;
    const stages: Stage[] = [
      { name: 'heartbeat', run: () => this.housekeeping.heartbeat('tick', opts.once) },
      { name: 'recovery', run: () => this.recovery.sweep() },
      {
        name: 'scans',
        run: () =>
          this.scheduler.runDueScans({
            ...(opts.once ? { maxSources: 8 } : {}),
            sourceIds: opts.sourceIds,
          }),
      },
      {
        name: 'classify',
        run: () =>
          this.classification.classifyPending(opts.once ? { batch: 200, maxAiCalls: 50 } : {}),
      },
      // Phase 6–9 stages slot in here: validate → match → notify → recheck → digest
      { name: 'retention', run: () => this.housekeeping.runRetention(opts.once) },
    ];
    for (const stage of stages) {
      if (this.stopping) break;
      const t0 = Date.now();
      try {
        await this.housekeeping.heartbeat(stage.name, opts.once).catch(() => undefined);
        const result = await stage.run();
        logger.debug(
          { stage: stage.name, durationMs: Date.now() - t0, result: summarize(result) },
          'stage done',
        );
      } catch (err) {
        logger.error({ err, stage: stage.name }, 'stage failed; continuing');
        await this.audit.event(
          'WORKER',
          `stage ${stage.name} failed`,
          { error: err instanceof Error ? err.message : String(err) },
          { level: 'ERROR' },
        );
      }
    }
    await this.housekeeping
      .heartbeat(opts.once ? 'done' : 'idle', opts.once)
      .catch(() => undefined);
  }
}

function summarize(result: unknown): unknown {
  if (Array.isArray(result)) return { count: result.length };
  return result ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ±10 % jitter so several workers/hosts never align exactly. */
function jitter(ms: number): number {
  return Math.round(ms * (0.9 + Math.random() * 0.2));
}
