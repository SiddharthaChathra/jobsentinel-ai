import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface HttpRequestOptions {
  method?: 'GET' | 'HEAD' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Follow up to N redirects manually (each hop is SSRF-checked and recorded). Default 5. */
  maxRedirects?: number;
  /** Cap on response bytes read; larger bodies are truncated with `truncated: true`. Default 20 MB (big ATS boards are 5–10 MB). */
  maxBodyBytes?: number;
  /** Retries on network errors / 5xx / 429. Default 2. Never retries other 4xx. */
  retries?: number;
  /** Bypass the per-host politeness gap (tests only). */
  skipPoliteness?: boolean;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  headers: Headers;
  url: string;
  /** Every hop after the original URL: [{ url, status }]. */
  redirectChain: { url: string; status: number }[];
  text: string;
  truncated: boolean;
  requestCount: number;
}

/**
 * Query parameters that carry credentials. Some APIs authenticate in the query string — Adzuna
 * takes `app_id`/`app_key` — and our error messages and redirect chains are written to
 * `scan_runs.error` and `job_validation`, so an un-redacted URL would persist a live key into the
 * database and the logs (D61).
 */
const SECRET_PARAMS =
  /^(app_key|api_key|apikey|key|token|access_token|auth|secret|client_secret|password|signature|sig)$/i;

/** Replaces the value of any credential-bearing query parameter with `***`. */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    let touched = false;
    for (const name of [...url.searchParams.keys()]) {
      if (SECRET_PARAMS.test(name)) {
        url.searchParams.set(name, '***');
        touched = true;
      }
    }
    return touched ? url.toString() : raw;
  } catch {
    return raw; // not a URL we can parse; nothing to redact
  }
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly code:
      'SSRF_BLOCKED' | 'TIMEOUT' | 'NETWORK' | 'TOO_MANY_REDIRECTS' | 'INVALID_URL',
    url?: string,
  ) {
    super(redactUrl(message));
    this.name = 'HttpError';
    this.url = url === undefined ? undefined : redactUrl(url);
  }

  readonly url?: string;
}

/** Ports so services and tests can swap the implementation (docs 05 §9). */
export interface HttpClientPort {
  request(url: string, opts?: HttpRequestOptions): Promise<HttpResponse>;
  getJson<T = unknown>(
    url: string,
    opts?: HttpRequestOptions,
  ): Promise<{ data: T; response: HttpResponse }>;
}

export interface HttpClientConfig {
  userAgent: string;
  defaultTimeoutMs: number;
  /** Minimum gap between requests to the same host (ms). */
  politenessMs?: number;
  fetchImpl?: typeof fetch;
  dnsLookup?: (host: string) => Promise<{ address: string }[]>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const PRIVATE_V4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT
  /^192\.0\.0\./,
  /^198\.1[89]\./,
  /^224\./,
  /^240\./,
  /^255\.255\.255\.255$/,
];

/** True for loopback, link-local, private, CGNAT, multicast and IPv4-mapped equivalents (docs 11 §2). */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return PRIVATE_V4.some((re) => re.test(ip));
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (
      lower.startsWith('fe8') ||
      lower.startsWith('fe9') ||
      lower.startsWith('fea') ||
      lower.startsWith('feb')
    )
      return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
    if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7)); // v4-mapped
    // NAT64 (RFC 6052, 64:ff9b::/96): ISPs synthesize these for IPv4-only hosts; the embedded
    // IPv4 (last 32 bits) decides — e.g. 64:ff9b::12a1:d80a is 18.161.216.10 (public).
    if (lower.startsWith('64:ff9b::')) {
      const embedded = nat64ToV4(lower);
      return embedded ? isPrivateAddress(embedded) : true;
    }
    return false;
  }
  return true; // not an IP at all → refuse
}

/** "64:ff9b::a0b:c0d" or "64:ff9b::1.2.3.4" → dotted IPv4, or null when malformed. */
export function nat64ToV4(addr: string): string | null {
  const tail = addr.slice('64:ff9b::'.length);
  if (isIP(tail) === 4) return tail;
  const groups = tail.split(':').filter(Boolean);
  if (groups.length === 0 || groups.length > 2 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g)))
    return null;
  const value =
    groups.length === 2
      ? (parseInt(groups[0]!, 16) << 16) | parseInt(groups[1]!, 16)
      : parseInt(groups[0]!, 16);
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}

/**
 * The only way outbound HTTP leaves the API/worker (docs 05 §2, 06 §4, 11 §2).
 * - resolves the host first and refuses private/loopback/link-local targets, on every redirect hop
 * - identifies itself with the configured User-Agent, sends no cookies or credentials
 * - per-host politeness gap, request timeout, retries with exponential backoff + jitter,
 *   honours Retry-After, caps the body size
 */
export class HttpClient implements HttpClientPort {
  private readonly lastRequestAt = new Map<string, number>();
  private readonly fetchImpl: typeof fetch;
  private readonly dnsLookup: (host: string) => Promise<{ address: string }[]>;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly cfg: HttpClientConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.dnsLookup = cfg.dnsLookup ?? ((host) => lookup(host, { all: true }));
    this.now = cfg.now ?? Date.now;
    this.sleep = cfg.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async getJson<T = unknown>(
    url: string,
    opts: HttpRequestOptions = {},
  ): Promise<{ data: T; response: HttpResponse }> {
    const response = await this.request(url, {
      ...opts,
      headers: { Accept: 'application/json', ...opts.headers },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${redactUrl(url)}`);
    let data: T;
    try {
      data = JSON.parse(response.text) as T;
    } catch {
      throw new Error(`Invalid JSON from ${redactUrl(url)}`);
    }
    return { data, response };
  }

  async request(url: string, opts: HttpRequestOptions = {}): Promise<HttpResponse> {
    const retries = opts.retries ?? 2;
    let attempt = 0;
    let requestCount = 0;
    for (;;) {
      try {
        const res = await this.follow(url, opts, () => requestCount++);
        res.requestCount = requestCount;
        if ((res.status >= 500 || res.status === 429) && attempt < retries) {
          attempt++;
          await this.sleep(this.retryDelay(attempt, res.headers.get('retry-after')));
          continue;
        }
        return res;
      } catch (err) {
        const retryable =
          err instanceof HttpError && (err.code === 'NETWORK' || err.code === 'TIMEOUT');
        if (!retryable || attempt >= retries) throw err;
        attempt++;
        await this.sleep(this.retryDelay(attempt, null));
      }
    }
  }

  private retryDelay(attempt: number, retryAfter: string | null): number {
    if (retryAfter) {
      const secs = Number(retryAfter);
      if (Number.isFinite(secs)) return Math.min(secs * 1000, 60_000);
      const at = Date.parse(retryAfter);
      if (!Number.isNaN(at)) return Math.max(0, Math.min(at - this.now(), 60_000));
    }
    const base = 500 * 2 ** (attempt - 1);
    return Math.round(base + Math.random() * base);
  }

  private async follow(
    startUrl: string,
    opts: HttpRequestOptions,
    onRequest: () => void,
  ): Promise<HttpResponse> {
    const maxRedirects = opts.maxRedirects ?? 5;
    const chain: { url: string; status: number }[] = [];
    let current = startUrl;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const parsed = this.parse(current);
      await this.assertPublic(parsed);
      if (!opts.skipPoliteness) await this.politeness(parsed.hostname);
      onRequest();

      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        opts.timeoutMs ?? this.cfg.defaultTimeoutMs,
      );
      let res: Response;
      try {
        res = await this.fetchImpl(parsed.toString(), {
          method: opts.method ?? 'GET',
          headers: {
            'User-Agent': this.cfg.userAgent,
            Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
            ...opts.headers,
          },
          body: opts.body,
          redirect: 'manual',
          signal: controller.signal,
          credentials: 'omit',
        });
      } catch (err) {
        clearTimeout(timer);
        if (controller.signal.aborted)
          throw new HttpError(`Timeout fetching ${current}`, 'TIMEOUT', current);
        throw new HttpError(
          `Network error fetching ${current}: ${err instanceof Error ? err.message : String(err)}`,
          'NETWORK',
          current,
        );
      }

      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        clearTimeout(timer);
        await res.body?.cancel().catch(() => undefined);
        const next = new URL(res.headers.get('location')!, parsed).toString();
        chain.push({ url: redactUrl(next), status: res.status });
        current = next;
        if (hop === maxRedirects)
          throw new HttpError(
            `Too many redirects from ${startUrl}`,
            'TOO_MANY_REDIRECTS',
            startUrl,
          );
        continue;
      }

      const { text, truncated } = await this.readBody(
        res,
        opts.maxBodyBytes ?? 20 * 1024 * 1024,
        controller,
        timer,
      );
      return {
        ok: res.ok,
        status: res.status,
        headers: res.headers,
        url: current,
        redirectChain: chain,
        text,
        truncated,
        requestCount: 0,
      };
    }
    throw new HttpError(`Too many redirects from ${startUrl}`, 'TOO_MANY_REDIRECTS', startUrl);
  }

  private parse(url: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new HttpError(`Invalid URL: ${url}`, 'INVALID_URL', url);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      throw new HttpError(`Unsupported protocol: ${url}`, 'INVALID_URL', url);
    if (parsed.username || parsed.password)
      throw new HttpError(`Credentials in URL are not allowed: ${url}`, 'INVALID_URL', url);
    return parsed;
  }

  private async assertPublic(url: URL): Promise<void> {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      throw new HttpError(`Blocked internal host: ${host}`, 'SSRF_BLOCKED', url.toString());
    }
    if (isIP(host)) {
      if (isPrivateAddress(host))
        throw new HttpError(`Blocked private address: ${host}`, 'SSRF_BLOCKED', url.toString());
      return;
    }
    let addresses: { address: string }[];
    try {
      addresses = await this.dnsLookup(host);
    } catch {
      throw new HttpError(`DNS lookup failed for ${host}`, 'NETWORK', url.toString());
    }
    if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
      throw new HttpError(
        `Blocked: ${host} resolves to a private address`,
        'SSRF_BLOCKED',
        url.toString(),
      );
    }
  }

  private async politeness(host: string): Promise<void> {
    const gap = this.cfg.politenessMs ?? 0;
    if (gap <= 0) return;
    const last = this.lastRequestAt.get(host) ?? 0;
    const wait = last + gap - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastRequestAt.set(host, this.now());
  }

  private async readBody(
    res: Response,
    max: number,
    controller: AbortController,
    timer: NodeJS.Timeout,
  ): Promise<{ text: string; truncated: boolean }> {
    try {
      if (!res.body) return { text: '', truncated: false };
      const reader = res.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
      const chunks: Uint8Array[] = [];
      let total = 0;
      let truncated = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > max) {
            chunks.push(value.subarray(0, value.byteLength - (total - max)));
            truncated = true;
            await reader.cancel().catch(() => undefined);
            break;
          }
          chunks.push(value);
        }
      }
      return { text: Buffer.concat(chunks).toString('utf8'), truncated };
    } catch (err) {
      if (controller.signal.aborted)
        throw new HttpError('Timeout reading body', 'TIMEOUT', res.url);
      throw new HttpError(
        `Body read failed: ${err instanceof Error ? err.message : String(err)}`,
        'NETWORK',
        res.url,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
