import pino from 'pino';
import type { Env } from '@jobsentinel/config';
import { loadEnv } from '@jobsentinel/config';
import type { ClassificationService } from '../jobs/classification.service';
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
    return {
      loop: new WorkerLoop(env, scheduler, classification, recovery, housekeeping, audit),
      scheduler,
      classification,
      recovery,
      housekeeping,
    };
  }

  it('runs every stage exactly once in --once mode', async () => {
    const { loop, scheduler, recovery, housekeeping, classification } = build();
    await loop.run({ once: true, logger });
    expect(scheduler.runDueScans).toHaveBeenCalledTimes(1);
    expect(recovery.sweep).toHaveBeenCalledTimes(1);
    expect(housekeeping.runRetention).toHaveBeenCalledWith(true);
    expect(classification.classifyPending).toHaveBeenCalledTimes(1);
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
