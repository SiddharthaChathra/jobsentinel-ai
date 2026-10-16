import {
  describeNetworkError,
  HttpClient,
  HttpError,
  isPrivateAddress,
  nat64ToV4,
  redactText,
  redactUrl,
} from './http-client';

describe('nat64ToV4', () => {
  it('decodes the embedded IPv4', () => {
    expect(nat64ToV4('64:ff9b::12a1:d80a')).toBe('18.161.216.10');
    expect(nat64ToV4('64:ff9b::2350:62bd')).toBe('35.80.98.189');
    expect(nat64ToV4('64:ff9b::1.2.3.4')).toBe('1.2.3.4');
    expect(nat64ToV4('64:ff9b::zz')).toBeNull();
  });
});

type Scripted = {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  throws?: string;
};

function makeClient(script: Record<string, Scripted[]>, dns: Record<string, string[]> = {}) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const queue = script[url];
    const step = queue?.shift();
    if (!step) throw new Error(`unscripted request ${url}`);
    if (step.throws) throw new Error(step.throws);
    return new Response(step.body ?? '', { status: step.status ?? 200, headers: step.headers });
  }) as unknown as typeof fetch;
  const client = new HttpClient({
    userAgent: 'JobSentinelAI/test',
    defaultTimeoutMs: 1000,
    politenessMs: 0,
    fetchImpl,
    dnsLookup: (host) =>
      Promise.resolve((dns[host] ?? ['93.184.216.34']).map((address) => ({ address }))),
    sleep: () => Promise.resolve(),
  });
  return { client, calls };
}

describe('isPrivateAddress', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['172.16.5.5', true],
    ['172.32.0.1', false],
    ['192.168.1.1', true],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['8.8.8.8', false],
    ['::1', true],
    ['fe80::1', true],
    ['fd00::1', true],
    ['::ffff:10.0.0.1', true],
    ['2606:4700::1111', false],
    ['64:ff9b::12a1:d80a', false], // NAT64 of 18.161.216.10 (public)
    ['64:ff9b::a00:1', true], // NAT64 of 10.0.0.1 (private)
    ['64:ff9b::7f00:1', true], // NAT64 of 127.0.0.1
    ['not-an-ip', true],
  ])('%s → %s', (ip, expected) => {
    expect(isPrivateAddress(ip)).toBe(expected);
  });
});

describe('HttpClient', () => {
  it('follows redirects manually, records the chain and returns the final body', async () => {
    const { client } = makeClient({
      'https://a.example/job': [{ status: 302, headers: { location: 'https://b.example/apply' } }],
      'https://b.example/apply': [{ status: 200, body: '<form>apply</form>' }],
    });
    const res = await client.request('https://a.example/job');
    expect(res.status).toBe(200);
    expect(res.url).toBe('https://b.example/apply');
    expect(res.redirectChain).toEqual([{ url: 'https://b.example/apply', status: 302 }]);
    expect(res.text).toContain('apply');
  });

  it('blocks private targets before connecting, including on redirect hops', async () => {
    const { client, calls } = makeClient(
      {
        'https://a.example/x': [
          { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } },
        ],
      },
      { 'a.example': ['1.2.3.4'] },
    );
    await expect(client.request('http://localhost:4000/')).rejects.toMatchObject({
      code: 'SSRF_BLOCKED',
    });
    await expect(client.request('http://10.0.0.5/')).rejects.toMatchObject({
      code: 'SSRF_BLOCKED',
    });
    await expect(client.request('https://a.example/x')).rejects.toMatchObject({
      code: 'SSRF_BLOCKED',
    });
    expect(calls).toEqual(['https://a.example/x']); // the metadata endpoint was never fetched
    const { client: c2 } = makeClient({}, { 'internal.example': ['192.168.0.10'] });
    await expect(c2.request('https://internal.example/')).rejects.toMatchObject({
      code: 'SSRF_BLOCKED',
    });
  });

  it('retries 5xx and network errors with backoff, but not 4xx', async () => {
    const { client, calls } = makeClient({
      'https://a.example/flaky': [
        { status: 503 },
        { throws: 'ECONNRESET' },
        { status: 200, body: 'ok' },
      ],
      'https://a.example/gone': [{ status: 404 }],
    });
    const res = await client.request('https://a.example/flaky', { retries: 3 });
    expect(res.status).toBe(200);
    expect(calls.filter((c) => c.endsWith('/flaky'))).toHaveLength(3);
    const gone = await client.request('https://a.example/gone', { retries: 3 });
    expect(gone.status).toBe(404);
    expect(calls.filter((c) => c.endsWith('/gone'))).toHaveLength(1);
  });

  it('gives up after retries are exhausted', async () => {
    const { client } = makeClient({
      'https://a.example/down': [{ throws: 'ECONNREFUSED' }, { throws: 'ECONNREFUSED' }],
    });
    await expect(client.request('https://a.example/down', { retries: 1 })).rejects.toBeInstanceOf(
      HttpError,
    );
  });

  it('caps the body size and flags truncation', async () => {
    const { client } = makeClient({
      'https://a.example/big': [{ status: 200, body: 'x'.repeat(10_000) }],
    });
    const res = await client.request('https://a.example/big', { maxBodyBytes: 1_000 });
    expect(res.truncated).toBe(true);
    expect(res.text.length).toBe(1_000);
  });

  it('parses JSON and rejects invalid JSON / error statuses', async () => {
    const { client } = makeClient({
      'https://a.example/j': [{ status: 200, body: '{"jobs":[1]}' }],
      'https://a.example/bad': [{ status: 200, body: '<html>' }],
      'https://a.example/err': [{ status: 403 }],
    });
    await expect(client.getJson<{ jobs: number[] }>('https://a.example/j')).resolves.toMatchObject({
      data: { jobs: [1] },
    });
    await expect(client.getJson('https://a.example/bad')).rejects.toThrow(/Invalid JSON/);
    await expect(client.getJson('https://a.example/err')).rejects.toThrow(/HTTP 403/);
  });

  it('rejects URLs with embedded credentials or unsupported schemes', async () => {
    const { client } = makeClient({});
    await expect(client.request('https://user:pw@a.example/')).rejects.toMatchObject({
      code: 'INVALID_URL',
    });
    await expect(client.request('ftp://a.example/')).rejects.toMatchObject({ code: 'INVALID_URL' });
  });
});

describe('redactUrl (D61)', () => {
  it('masks credential-bearing query parameters', () => {
    expect(
      redactUrl('https://api.adzuna.com/v1/api/jobs/in/search/1?app_id=abc&app_key=SECRET'),
    ).toBe('https://api.adzuna.com/v1/api/jobs/in/search/1?app_id=abc&app_key=***');
    expect(redactUrl('https://x.test/a?token=abc&api_key=def&q=python')).toBe(
      'https://x.test/a?token=***&api_key=***&q=python',
    );
  });

  it('leaves ordinary URLs untouched', () => {
    const url = 'https://boards-api.greenhouse.io/v1/boards/groww/jobs?content=true';
    expect(redactUrl(url)).toBe(url);
    expect(redactUrl('not a url')).toBe('not a url');
  });

  it('masks a Telegram bot token in the path (D98)', () => {
    expect(redactUrl('https://api.telegram.org/bot123456:AAH-fake_Token9/sendMessage')).toBe(
      'https://api.telegram.org/bot***/sendMessage',
    );
  });
});

describe('redactText (D98)', () => {
  it('redacts URLs quoted inside a message', () => {
    expect(
      redactText(
        'Network error fetching https://api.telegram.org/bot123456:AAH-fake_Token9/sendMessage: fetch failed',
      ),
    ).toBe('Network error fetching https://api.telegram.org/bot***/sendMessage: fetch failed');
    expect(redactText('HTTP 500 for https://x.test/a?app_key=SECRET, retrying')).toBe(
      'HTTP 500 for https://x.test/a?app_key=***, retrying',
    );
  });

  it('is what HttpError messages go through', () => {
    const err = new HttpError(
      'Network error fetching https://api.telegram.org/bot1:abc/getMe: fetch failed',
      'NETWORK',
      'https://api.telegram.org/bot1:abc/getMe',
    );
    expect(err.message).not.toContain('bot1:abc');
    expect(err.url).toBe('https://api.telegram.org/bot***/getMe');
  });
});

describe('describeNetworkError', () => {
  it('surfaces the cause undici hides behind "fetch failed"', () => {
    const cause = Object.assign(new Error('connect ETIMEDOUT 1.2.3.4:443'), { code: 'ETIMEDOUT' });
    expect(describeNetworkError(new TypeError('fetch failed', { cause }))).toBe(
      'fetch failed (ETIMEDOUT: connect ETIMEDOUT 1.2.3.4:443)',
    );
    expect(describeNetworkError(new Error('plain'))).toBe('plain');
    expect(describeNetworkError('odd')).toBe('odd');
  });
});
