import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  HttpClientPort,
  HttpRequestOptions,
  HttpResponse,
} from '../../src/common/http/http-client';

export type FakeRoute = {
  status?: number;
  body?: string;
  file?: string;
  throws?: Error;
  headers?: Record<string, string>;
};

/** Scripted HttpClientPort: match by URL prefix; records every request for assertions. */
export class FakeHttpClient implements HttpClientPort {
  readonly requests: { url: string; opts?: HttpRequestOptions }[] = [];
  constructor(private readonly routes: Record<string, FakeRoute | FakeRoute[]>) {}

  request(url: string, opts?: HttpRequestOptions): Promise<HttpResponse> {
    this.requests.push({ url, opts });
    const key = Object.keys(this.routes).find((k) => url.startsWith(k));
    if (!key) return Promise.reject(new Error(`unscripted request: ${url}`));
    const entry = this.routes[key]!;
    const route = Array.isArray(entry)
      ? (entry.shift() ?? { status: 500, body: 'script exhausted' })
      : entry;
    if (route.throws) return Promise.reject(route.throws);
    const text = route.file
      ? readFileSync(join(__dirname, '..', 'fixtures', route.file), 'utf8')
      : (route.body ?? '');
    const status = route.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(route.headers ?? {}),
      url,
      redirectChain: [],
      text,
      truncated: false,
      requestCount: 1,
    });
  }

  async getJson<T = unknown>(
    url: string,
    opts?: HttpRequestOptions,
  ): Promise<{ data: T; response: HttpResponse }> {
    const response = await this.request(url, opts);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return { data: JSON.parse(response.text) as T, response };
  }
}

export const silentLog = { debug: () => undefined, warn: () => undefined };
