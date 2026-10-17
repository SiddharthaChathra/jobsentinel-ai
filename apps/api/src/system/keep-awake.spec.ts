import { loadEnv } from '@jobsentinel/config';
import type { HttpClientPort, HttpResponse } from '../common/http/http-client';
import { KEEP_AWAKE_INTERVAL_MS, KeepAwakeService, withinAwakeHours } from './keep-awake.service';

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

describe('withinAwakeHours (D99)', () => {
  // 01:30 UTC is 07:00 in India; 18:30 UTC is midnight.
  const ist = (utc: string) => new Date(`2026-10-17T${utc}:00Z`);

  it.each([
    ['01:29', false], // 06:59 IST
    ['01:30', true], // 07:00 IST
    ['12:00', true], // 17:30 IST
    ['18:29', true], // 23:59 IST
    ['18:30', false], // 00:00 IST
    ['21:00', false], // 02:30 IST
  ])('7-24 in Asia/Kolkata at %s UTC -> %s', (utc, expected) => {
    expect(withinAwakeHours(ist(utc), '7-24', 'Asia/Kolkata')).toBe(expected);
  });

  it('treats 0-24 as always and equal ends as never', () => {
    for (const h of ['00:00', '06:00', '12:00', '23:59']) {
      expect(withinAwakeHours(ist(h), '0-24', 'UTC')).toBe(true);
      expect(withinAwakeHours(ist(h), '9-9', 'UTC')).toBe(false);
    }
  });

  it('supports a window that wraps past midnight', () => {
    expect(withinAwakeHours(ist('23:00'), '22-6', 'UTC')).toBe(true);
    expect(withinAwakeHours(ist('05:59'), '22-6', 'UTC')).toBe(true);
    expect(withinAwakeHours(ist('06:00'), '22-6', 'UTC')).toBe(false);
  });
});

describe('KeepAwakeService with a window (D99)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('pings during the window and lets the instance sleep outside it', async () => {
    const { http, urls } = fakeHttp(() => Promise.resolve({ ok: true, status: 200 }));
    const svc = new KeepAwakeService(
      loadEnv({
        RENDER_EXTERNAL_URL: 'https://api.example.onrender.com',
        KEEP_AWAKE_HOURS: '7-24',
        KEEP_AWAKE_TZ: 'Asia/Kolkata',
      }),
      http,
    );
    jest.setSystemTime(new Date('2026-10-17T18:00:00Z')); // 23:30 IST
    svc.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(KEEP_AWAKE_INTERVAL_MS * 2); // 23:40, 23:50
    expect(urls).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(KEEP_AWAKE_INTERVAL_MS * 6); // 00:00 - 00:50
    expect(urls).toHaveLength(2);
    svc.onModuleDestroy();
  });
});
