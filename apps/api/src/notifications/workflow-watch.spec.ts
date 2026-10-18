import { loadEnv } from '@jobsentinel/config';
import type { HttpClientPort } from '../common/http/http-client';
import type { NotificationsService } from './notifications.service';
import { workflowProblem } from './workflow-watch';
import { WorkflowWatchService } from './workflow-watch.service';

const NOW = new Date('2026-10-18T06:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe('workflowProblem (D125)', () => {
  it('fine when active and run within 10 days (a weekly backup is 7 days apart)', () => {
    expect(workflowProblem({ state: 'active', lastRunAt: daysAgo(7) }, NOW)).toBeNull();
    expect(workflowProblem({ state: 'active', lastRunAt: daysAgo(10) }, NOW)).toBeNull();
  });

  it('stale past 10 days, or never run', () => {
    expect(workflowProblem({ state: 'active', lastRunAt: daysAgo(11) }, NOW)).toBe(
      'last run 11 days ago',
    );
    expect(workflowProblem({ state: 'active', lastRunAt: null }, NOW)).toBe('it has never run');
  });

  it('disabled for inactivity (the 60-day rule) or by hand is a problem whatever the last run', () => {
    expect(workflowProblem({ state: 'disabled_inactivity', lastRunAt: daysAgo(1) }, NOW)).toBe(
      'GitHub reports it as disabled inactivity',
    );
    expect(workflowProblem({ state: 'disabled_manually', lastRunAt: daysAgo(1) }, NOW)).toContain(
      'disabled manually',
    );
  });
});

describe('WorkflowWatchService (D125)', () => {
  const env = loadEnv({ WORKER_DISPATCH_TOKEN: 'github_pat_test' });
  const setup = (workflows: Record<string, { state: string; lastRunAt: string | null }>) => {
    const puts: string[] = [];
    const http = {
      getJson: (url: string) => {
        const file = /workflows\/([^/?]+)/.exec(url)![1]!;
        const w = workflows[file]!;
        return Promise.resolve({
          data: url.includes('/runs')
            ? { workflow_runs: w.lastRunAt ? [{ created_at: w.lastRunAt }] : [] }
            : { state: w.state },
          response: { status: 200 },
        });
      },
      request: (url: string) => {
        puts.push(url);
        return Promise.resolve({ ok: true, status: 204 });
      },
    } as unknown as HttpClientPort;
    const alerts: { key: string; detail: string; window: number }[] = [];
    const notifications = {
      adminIds: () => Promise.resolve(['admin-1']),
      enqueueSystemAlert: (_u: string, key: string, _t: string, detail: string, window: number) => {
        alerts.push({ key, detail, window });
        return Promise.resolve(true);
      },
    } as unknown as NotificationsService;
    return { svc: new WorkflowWatchService(env, http, notifications), puts, alerts };
  };

  it('says nothing when both workflows are active and recent', async () => {
    const { svc, alerts, puts } = setup({
      'backup.yml': { state: 'active', lastRunAt: daysAgo(6).toISOString() },
      'uptime.yml': { state: 'active', lastRunAt: daysAgo(0).toISOString() },
    });
    await svc.check(NOW);
    expect(alerts).toHaveLength(0);
    expect(puts).toHaveLength(0);
  });

  it('alerts once a day for a silent backup, and re-enables a workflow GitHub disabled for inactivity', async () => {
    const { svc, alerts, puts } = setup({
      'backup.yml': { state: 'active', lastRunAt: daysAgo(12).toISOString() },
      'uptime.yml': { state: 'disabled_inactivity', lastRunAt: daysAgo(61).toISOString() },
    });
    const result = await svc.check(NOW);
    expect(result).toEqual([
      { file: 'backup.yml', problem: 'last run 12 days ago', reenabled: false },
      { file: 'uptime.yml', problem: 'GitHub reports it as disabled inactivity', reenabled: true },
    ]);
    expect(puts).toEqual([
      'https://api.github.com/repos/SiddharthaChathra/jobsentinel-ai/actions/workflows/uptime.yml/enable',
    ]);
    expect(alerts.map((a) => [a.key, a.window])).toEqual([
      ['workflow-stale:backup.yml', 24],
      ['workflow-stale:uptime.yml', 24],
    ]);
    expect(alerts[1]!.detail).toContain('re-enabled automatically');
  });

  it('is off without the dispatch token (the GitHub-hosted worker)', () => {
    const { svc } = setup({});
    const off = new WorkflowWatchService(
      loadEnv({}),
      {} as HttpClientPort,
      {} as NotificationsService,
    );
    expect(() => off.onApplicationBootstrap()).not.toThrow();
    svc.onModuleDestroy();
  });
});
