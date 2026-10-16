import { loadEnv } from '@jobsentinel/config';
import type { HttpClientPort, HttpResponse } from '../common/http/http-client';
import { KEEP_AWAKE_INTERVAL_MS, KeepAwakeService } from './keep-awake.service';

function fakeHttp(respond: () => Promise<Partial<HttpResponse>>) {
  const urls: string[] = [];
  const http = {
    request: (url: string) => {
      urls.push(url);
      return respond();
    },
  } as unknown as HttpClientPort;
  return { http, urls };
}

describe('KeepAwakeService (D94)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('pings the public /health every interval when Render provides the URL', async () => {
    const { http, urls } = fakeHttp(() => Promise.resolve({ ok: true, status: 200 }));
    const svc = new KeepAwakeService(
      loadEnv({ RENDER_EXTERNAL_URL: 'https://api.example.onrender.com/' }),
      http,
    );
    svc.onApplicationBootstrap();
    expect(urls).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(KEEP_AWAKE_INTERVAL_MS);
    await jest.advanceTimersByTimeAsync(KEEP_AWAKE_INTERVAL_MS);
    expect(urls).toEqual([
      'https://api.example.onrender.com/health',
      'https://api.example.onrender.com/health',
    ]);
    svc.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(KEEP_AWAKE_INTERVAL_MS);
    expect(urls).toHaveLength(2);
  });

  it('stays under Render’s 15-minute idle limit', () => {
    expect(KEEP_AWAKE_INTERVAL_MS).toBeLessThan(15 * 60 * 1000);
  });

  it('does nothing outside Render (local, tests, the worker)', async () => {
    const { http, urls } = fakeHttp(() => Promise.resolve({ ok: true, status: 200 }));
    const svc = new KeepAwakeService(loadEnv({}), http);
    svc.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(KEEP_AWAKE_INTERVAL_MS * 3);
    expect(urls).toHaveLength(0);
  });

  it('never throws when a ping fails', async () => {
    const { http } = fakeHttp(() => Promise.reject(new Error('ECONNRESET')));
    const svc = new KeepAwakeService(loadEnv({}), http);
    await expect(svc.ping('https://api.example.onrender.com/health')).resolves.toBeUndefined();
  });
});
