import pino from 'pino';
import type { Env } from '@jobsentinel/config';
import { loadEnv } from '@jobsentinel/config';
import type { ClassificationService } from '../jobs/classification.service';
import type { MatchingService } from '../matching/matching.service';
import type { ValidationOrchestrator } from '../validation/validation.orchestrator';
import type { AuditLogger } from '../system/audit-logger';
import type { HousekeepingService } from './housekeeping.service';
import type { RecoveryService } from './recovery.service';
import type { SchedulerService } from './scheduler.service';
import { WorkerLoop } from './worker-loop';

describe('WorkerLoop', () => {
  const env: Env = loadEnv({ WORKER_TICK_MS: '1000' });
  const logger = pino({ level: 'silent' });
  const audit = { event: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogger;

  function build(
    overrides: { scans?: () => Promise<unknown>; recovery?: () => Promise<unknown> } = {},
  ) {
    const scheduler = {
      runDueScans: jest.fn(overrides.scans ?? (() => Promise.resolve([]))),
    } as unknown as SchedulerService;
    const recovery = {
      sweep: jest.fn(overrides.recovery ?? (() => Promise.resolve({}))),
    } as unknown as RecoveryService;
    const housekeeping = {
      workerId: 'test-1',
      heartbeat: jest.fn().mockResolvedValue(undefined),
      runRetention: jest.fn().mockResolvedValue(undefined),
    } as unknown as HousekeepingService;
    const classification = {
      classifyPending: jest.fn().mockResolvedValue({ processed: 0 }),
    } as unknown as ClassificationService;
    const validation = {
      validatePending: jest.fn().mockResolvedValue({ processed: 0 }),
      recheckDue: jest.fn().mockResolvedValue({ checked: 0, expired: 0 }),
    } as unknown as ValidationOrchestrator;
    const matching = {
      matchPending: jest.fn().mockResolvedValue({ scored: 0 }),
    } as unknown as MatchingService;
    return {
      loop: new WorkerLoop(
        env,
        scheduler,
        classification,
        validation,
        matching,
        recovery,
        housekeeping,
        audit,
      ),
      scheduler,
      classification,
      validation,
      matching,
      recovery,
      housekeeping,
    };
  }

  it('runs every stage exactly once in --once mode', async () => {
    const { loop, scheduler, recovery, housekeeping, classification, validation, matching } =
      build();
    await loop.run({ once: true, logger });
    expect(scheduler.runDueScans).toHaveBeenCalledTimes(1);
    expect(recovery.sweep).toHaveBeenCalledTimes(1);
    expect(housekeeping.runRetention).toHaveBeenCalledWith(true);
    expect(classification.classifyPending).toHaveBeenCalledTimes(1);
    expect(validation.validatePending).toHaveBeenCalledTimes(1);
    expect(validation.recheckDue).toHaveBeenCalledTimes(1);
    expect(matching.matchPending).toHaveBeenCalledTimes(1);
  });

  it('a failing stage does not stop later stages or reject the loop', async () => {
    const { loop, scheduler, housekeeping } = build({
      recovery: () => Promise.reject(new Error('db hiccup')),
    });
    await expect(loop.run({ once: true, logger })).resolves.toBeUndefined();
    expect(scheduler.runDueScans).toHaveBeenCalledTimes(1);
    expect(housekeeping.runRetention).toHaveBeenCalledTimes(1);
    expect(
      (audit.event as jest.Mock).mock.calls.some((c) =>
        String(c[1]).includes('stage recovery failed'),
      ),
    ).toBe(true);
  });
});
