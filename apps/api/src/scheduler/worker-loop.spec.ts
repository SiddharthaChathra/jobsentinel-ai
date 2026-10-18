import type { SourceReportService } from '../sources/source-report.service';
import type { CompanyFresherService } from '../sources/company-fresher.service';
import type { RemindersService } from '../notifications/reminders.service';
import type { WeeklySummaryService } from '../notifications/weekly-summary.service';
import pino from 'pino';
import type { Env } from '@jobsentinel/config';
import { loadEnv } from '@jobsentinel/config';
import type { ClassificationService } from '../jobs/classification.service';
import type { MatchingService } from '../matching/matching.service';
import type { DigestService } from '../notifications/digest.service';
import type { DispatcherService } from '../notifications/dispatcher.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { TelegramPollerService } from '../notifications/telegram-poller.service';
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
    const notificationsSvc = {
      enqueuePending: jest.fn().mockResolvedValue({ instant: 0 }),
    } as unknown as NotificationsService;
    const dispatcher = {
      dispatchPending: jest.fn().mockResolvedValue({ sent: 0 }),
    } as unknown as DispatcherService;
    const digest = {
      sendDue: jest.fn().mockResolvedValue({ queued: 0 }),
    } as unknown as DigestService;
    const poller = {
      poll: jest.fn().mockResolvedValue({ updates: 0 }),
    } as unknown as TelegramPollerService;
    const matching = {
      matchPending: jest.fn().mockResolvedValue({ scored: 0 }),
      refinePending: jest.fn().mockResolvedValue({ pending: 0, refined: 0 }),
    } as unknown as MatchingService;
    return {
      loop: new WorkerLoop(
        env,
        scheduler,
        classification,
        validation,
        matching,
        notificationsSvc,
        dispatcher,
        digest,
        poller,
        recovery,
        housekeeping,
        audit,
        {
          autoPause: jest.fn().mockResolvedValue({ paused: [], alerted: [] }),
        } as unknown as SourceReportService,
        {
          recomputeIfStale: jest.fn().mockResolvedValue({ skipped: true }),
        } as unknown as CompanyFresherService,
        {
          plan: jest.fn().mockResolvedValue({ created: 0, cancelled: 0, revived: 0 }),
          deliver: jest.fn().mockResolvedValue({ sent: 0, deferred: 0, cancelled: 0 }),
        } as unknown as RemindersService,
        {
          sendDue: jest.fn().mockResolvedValue({ considered: 0, queued: 0, notDue: 0 }),
        } as unknown as WeeklySummaryService,
      ),
      scheduler,
      classification,
      validation,
      matching,
      notificationsSvc,
      dispatcher,
      digest,
      poller,
      recovery,
      housekeeping,
    };
  }

  it('runs every stage exactly once in --once mode', async () => {
    const {
      loop,
      scheduler,
      recovery,
      housekeeping,
      classification,
      validation,
      matching,
      notificationsSvc,
      dispatcher,
      digest,
      poller,
    } = build();
    await loop.run({ once: true, logger });
    expect(scheduler.runDueScans).toHaveBeenCalledTimes(1);
    expect(recovery.sweep).toHaveBeenCalledTimes(1);
    expect(housekeeping.runRetention).toHaveBeenCalledWith(true);
    expect(classification.classifyPending).toHaveBeenCalledTimes(1);
    expect(validation.validatePending).toHaveBeenCalledTimes(1);
    expect(validation.recheckDue).toHaveBeenCalledTimes(1);
    expect(matching.matchPending).toHaveBeenCalledTimes(1);
    expect(matching.refinePending).toHaveBeenCalledTimes(1);
    expect(notificationsSvc.enqueuePending).toHaveBeenCalledTimes(1);
    expect(dispatcher.dispatchPending).toHaveBeenCalledTimes(1);
    expect(digest.sendDue).toHaveBeenCalledTimes(1);
    expect(poller.poll).toHaveBeenCalledTimes(1);
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
