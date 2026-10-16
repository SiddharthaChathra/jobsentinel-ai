import { loadEnv } from '@jobsentinel/config';
import type { HttpClientPort, HttpRequestOptions } from '../common/http/http-client';
import { WorkerDispatchService } from './worker-dispatch.service';

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
});
