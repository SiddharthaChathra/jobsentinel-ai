import { loadEnv } from '@jobsentinel/config';
import type { HttpClientPort, HttpRequestOptions } from '../common/http/http-client';
import type { Db } from '../common/db/db.module';
import { isOverdue, WorkerDispatchService } from './worker-dispatch.service';

function fakeHttp(status: number | Error) {
  const calls: { url: string; opts: HttpRequestOptions }[] = [];
  const http = {
    request: (url: string, opts: HttpRequestOptions) => {
      calls.push({ url, opts });
      return status instanceof Error
        ? Promise.reject(status)
        : Promise.resolve({ ok: status < 300, status });
    },
  } as unknown as HttpClientPort;
  return { http, calls };
}

describe('WorkerDispatchService (D95)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('asks GitHub to run worker.yml on main, on the configured interval', async () => {
    const { http, calls } = fakeHttp(204);
    const svc = new WorkerDispatchService(
      loadEnv({ WORKER_DISPATCH_TOKEN: 'github_pat_test', WORKER_DISPATCH_INTERVAL_MIN: '30' }),
      http,
    );
    svc.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(29 * 60_000);
    expect(calls).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(
      'https://api.github.com/repos/SiddharthaChathra/jobsentinel-ai/actions/workflows/worker.yml/dispatches',
    );
    expect(call.opts.method).toBe('POST');
    expect(call.opts.headers?.Authorization).toBe('Bearer github_pat_test');
    expect(JSON.parse(call.opts.body ?? '{}')).toEqual({ ref: 'main' });
    svc.onModuleDestroy();
  });

  it('is off without a token', async () => {
    const { http, calls } = fakeHttp(204);
    const svc = new WorkerDispatchService(loadEnv({}), http);
    svc.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(calls).toHaveLength(0);
    await expect(svc.dispatch()).resolves.toBe(false);
  });

  it('reports a rejected token or a network failure without throwing', async () => {
    const env = loadEnv({ WORKER_DISPATCH_TOKEN: 'bad' });
    await expect(new WorkerDispatchService(env, fakeHttp(401).http).dispatch()).resolves.toBe(
      false,
    );
    await expect(
      new WorkerDispatchService(env, fakeHttp(new Error('ETIMEDOUT')).http).dispatch(),
    ).resolves.toBe(false);
  });

  it('refuses an interval short enough to flood GitHub', () => {
    expect(() => loadEnv({ WORKER_DISPATCH_INTERVAL_MIN: '1' })).toThrow(
      /WORKER_DISPATCH_INTERVAL_MIN/,
    );
  });

  describe('catch-up after a restart (D124)', () => {
    const env = loadEnv({
      WORKER_DISPATCH_TOKEN: 'github_pat_test',
      WORKER_DISPATCH_INTERVAL_MIN: '30',
    });
    const dbWithBeat = (at: Date | null) =>
      ({ execute: () => Promise.resolve([{ at }]) }) as unknown as Db;

    it('overdue only past one interval, or with no heartbeat at all', () => {
      const now = new Date('2026-10-18T06:00:00Z');
      expect(isOverdue(new Date('2026-10-18T05:31:00Z'), now, 30)).toBe(false);
      expect(isOverdue(new Date('2026-10-18T05:29:00Z'), now, 30)).toBe(true);
      expect(isOverdue(null, now, 30)).toBe(true);
    });

    it('a minute after boot, dispatches at once when the worker has been quiet past the interval', async () => {
      const { http, calls } = fakeHttp(204);
      const svc = new WorkerDispatchService(
        env,
        http,
        dbWithBeat(new Date(Date.now() - 75 * 60_000)),
      );
      svc.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(60_000);
      expect(calls).toHaveLength(1);
      svc.onModuleDestroy();
    });

    it('does not dispatch early when the worker ran recently', async () => {
      const { http, calls } = fakeHttp(204);
      const svc = new WorkerDispatchService(
        env,
        http,
        dbWithBeat(new Date(Date.now() - 10 * 60_000)),
      );
      svc.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(60_000);
      expect(calls).toHaveLength(0);
      svc.onModuleDestroy();
    });

    it('a failing database check never throws and never dispatches', async () => {
      const { http, calls } = fakeHttp(204);
      const broken = { execute: () => Promise.reject(new Error('db down')) } as unknown as Db;
      await expect(new WorkerDispatchService(env, http, broken).catchUp()).resolves.toBe(false);
      expect(calls).toHaveLength(0);
    });
  });
});
