import { Inject, Injectable } from '@nestjs/common';
import type { Env } from '@jobsentinel/config';
import type { Logger } from 'pino';
import { ENV } from '../common/config/config.module';
import { ClassificationService } from '../jobs/classification.service';
import { AuditLogger } from '../system/audit-logger';
import { MatchingService } from '../matching/matching.service';
import { DigestService } from '../notifications/digest.service';
import { DispatcherService } from '../notifications/dispatcher.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TelegramPollerService } from '../notifications/telegram-poller.service';
import { ValidationOrchestrator } from '../validation/validation.orchestrator';
import { HousekeepingService } from './housekeeping.service';
import { RecoveryService } from './recovery.service';
import { SchedulerService } from './scheduler.service';
import { SourceReportService } from '../sources/source-report.service';

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
    private readonly validation: ValidationOrchestrator,
    private readonly matching: MatchingService,
    private readonly notifications: NotificationsService,
    private readonly dispatcher: DispatcherService,
    private readonly digest: DigestService,
    private readonly poller: TelegramPollerService,
    private readonly recovery: RecoveryService,
    private readonly housekeeping: HousekeepingService,
    private readonly audit: AuditLogger,
    private readonly sourceReport: SourceReportService,
  ) {}

  /**
   * Pauses sources that collect jobs but keep none, and tells the admins once per pause; for
   * India-scoped sources, which are never paused, sends a "kept none" alert at most once per
   * window instead (D103, D104).
   */
  private async pauseIdleSources(): Promise<{ paused: number; alerted: number }> {
    const { paused, alerted } = await this.sourceReport.autoPause();
    if (paused.length + alerted.length === 0) return { paused: 0, alerted: 0 };
    const admins = await this.notifications.adminIds();
    for (const adminId of admins) {
      for (const p of paused) {
        await this.notifications.enqueueSystemAlert(
          adminId,
          `source-paused:${p.id}`,
          `Source paused: ${p.name}`,
          `${p.reason}. It will not be scanned until resumed (System Status, Sources).`,
        );
      }
      for (const a of alerted) {
        await this.notifications.enqueueSystemAlert(
          adminId,
          `source-kept-zero:${a.id}`,
          `Source keeps nothing: ${a.name}`,
          `${a.reason}. India-scoped, so it was not paused (D104). Check its queries or filters.`,
        );
      }
    }
    return { paused: paused.length, alerted: alerted.length };
  }

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
          this.classification.classifyPending(
            // 3 minutes of AI per run: unknown-experience jobs wait for a verdict (D96), and the
            // free tier's pacing allows ~13 calls a minute.
            opts.once ? { batch: 200, maxAiCalls: 50, aiTimeBudgetMs: 180_000 } : {},
          ),
      },
      {
        name: 'validate',
        run: () =>
          this.validation.validatePending(
            opts.once ? { batch: 60, maxAiCalls: 10, timeBudgetMs: 300_000 } : {},
          ),
      },
      { name: 'recheck', run: () => this.validation.recheckDue(opts.once ? { batch: 40 } : {}) },
      {
        name: 'match',
        run: () => this.matching.matchPending(opts.once ? { batch: 300, maxAiCalls: 20 } : {}),
      },
      // Picks up matches whose AI refinement was skipped when the budget or provider was out
      // — the AI_PENDING drain of docs 07 §1.4.
      {
        name: 'refine',
        run: () => this.matching.refinePending(opts.once ? { batch: 40, maxAiCalls: 10 } : {}),
      },
      // Alerts: decide → deliver → summarise. Each is isolated, so a Telegram outage cannot
      // stop scanning, and the web inbox is written even when delivery fails (docs 10 §5).
      // Before notify/dispatch, so a pause notice goes out in the same tick (F2, D103).
      { name: 'source-health', run: () => this.pauseIdleSources() },
      {
        name: 'notify',
        run: () => this.notifications.enqueuePending(opts.once ? { batch: 200 } : {}),
      },
      {
        name: 'dispatch',
        run: () => this.dispatcher.dispatchPending(opts.once ? { batch: 50 } : {}),
      },
      { name: 'digest', run: () => this.digest.sendDue() },
      { name: 'telegram', run: () => this.poller.poll({ timeoutSec: opts.once ? 1 : 25 }) },
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
