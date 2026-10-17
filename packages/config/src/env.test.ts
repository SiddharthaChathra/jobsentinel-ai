import { assertEnv, loadEnv, parseEmailList, toOrigin } from './env';

describe('loadEnv', () => {
  it('applies defaults when variables are absent', () => {
    const env = loadEnv({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.WORKER_TICK_MS).toBe(60_000);
    expect(env.AI_PROVIDER).toBe('gemini');
    expect(env.ALLOWED_SIGNUP_EMAILS).toBe('*');
    expect(env.ADMIN_EMAILS).toEqual([]);
    expect(env.ENABLE_API_DOCS).toBe(false);
    expect(env.TELEGRAM_POLLING).toBe(true);
  });

  it('coerces numbers and booleans from strings', () => {
    const env = loadEnv({ PORT: '5001', ENABLE_API_DOCS: 'true', TELEGRAM_POLLING: '0' });
    expect(env.PORT).toBe(5001);
    expect(env.ENABLE_API_DOCS).toBe(true);
    expect(env.TELEGRAM_POLLING).toBe(false);
  });

  it('parses email lists', () => {
    const env = loadEnv({
      ALLOWED_SIGNUP_EMAILS: ' Me@Example.com, other@example.com ',
      ADMIN_EMAILS: 'me@example.com',
    });
    expect(env.ALLOWED_SIGNUP_EMAILS).toEqual(['me@example.com', 'other@example.com']);
    expect(env.ADMIN_EMAILS).toEqual(['me@example.com']);
  });

  it('rejects invalid values with a readable message', () => {
    expect(() => loadEnv({ PORT: 'abc', AI_PROVIDER: 'openai' })).toThrow(/PORT/);
    expect(() => loadEnv({ AI_PROVIDER: 'openai' })).toThrow(/AI_PROVIDER/);
  });

  it('treats empty strings as unset', () => {
    const env = loadEnv({ SUPABASE_URL: '', PORT: '' });
    expect(env.SUPABASE_URL).toBeUndefined();
    expect(env.PORT).toBe(4000);
  });

  it('derives SUPABASE_JWT_ISSUER from SUPABASE_URL when not given', () => {
    const env = loadEnv({ SUPABASE_URL: 'https://abc.supabase.co' });
    expect(env.SUPABASE_JWT_ISSUER).toBe('https://abc.supabase.co/auth/v1');
  });
});

describe('assertEnv', () => {
  it('lists every missing required key', () => {
    const env = loadEnv({});
    expect(() => assertEnv(env, ['SUPABASE_URL', 'DATABASE_URL'])).toThrow(
      /SUPABASE_URL[\s\S]*DATABASE_URL/,
    );
  });

  it('passes when keys are present', () => {
    const env = loadEnv({ SUPABASE_URL: 'https://abc.supabase.co' });
    expect(() => assertEnv(env, ['SUPABASE_URL'])).not.toThrow();
  });
});

describe('parseEmailList', () => {
  it('returns * for wildcard', () => {
    expect(parseEmailList('*')).toBe('*');
  });
  it('dedupes and lowercases', () => {
    expect(parseEmailList('A@x.com,a@x.com,b@x.com')).toEqual(['a@x.com', 'b@x.com']);
  });
});

// D89: Render refused to boot on a WEB_ORIGIN without a scheme, and a trailing slash would have
// booted but blocked every CORS request.
describe('web origins', () => {
  it.each([
    ['jobsentinel-ai.vercel.app', 'https://jobsentinel-ai.vercel.app'],
    ['https://jobsentinel-ai.vercel.app/', 'https://jobsentinel-ai.vercel.app'],
    ['  https://jobsentinel-ai.vercel.app/login ', 'https://jobsentinel-ai.vercel.app'],
    ['HTTPS://JobSentinel-AI.vercel.app', 'https://jobsentinel-ai.vercel.app'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['localhost:3000', 'https://localhost:3000'],
  ])('%s -> %s', (raw, origin) => {
    expect(toOrigin(raw)).toBe(origin);
  });

  it('rejects things that are not web addresses', () => {
    expect(toOrigin('ftp://example.com')).toBeNull();
    expect(toOrigin('not a url')).toBeNull();
    expect(toOrigin('')).toBeNull();
  });

  it('accepts a comma-separated WEB_ORIGIN list and normalizes APP_BASE_URL', () => {
    const env = loadEnv({
      WEB_ORIGIN:
        'jobsentinel-ai.vercel.app/, http://localhost:3000,https://jobsentinel-ai.vercel.app',
      APP_BASE_URL: 'https://jobsentinel-ai.vercel.app/',
    });
    expect(env.WEB_ORIGIN).toEqual(['https://jobsentinel-ai.vercel.app', 'http://localhost:3000']);
    expect(env.APP_BASE_URL).toBe('https://jobsentinel-ai.vercel.app');
    expect(loadEnv({}).WEB_ORIGIN).toEqual(['http://localhost:3000']);
  });

  it('still fails clearly on a value that cannot be an origin', () => {
    expect(() => loadEnv({ WEB_ORIGIN: 'https://ok.example, not a url' })).toThrow(/WEB_ORIGIN/);
  });
});

describe('keep-awake window (D99)', () => {
  it('defaults to all day in India', () => {
    const env = loadEnv({});
    expect(env.KEEP_AWAKE_HOURS).toBe('0-24');
    expect(env.KEEP_AWAKE_TZ).toBe('Asia/Kolkata');
  });

  it('accepts HH-HH and a real time zone', () => {
    const env = loadEnv({ KEEP_AWAKE_HOURS: '07-24', KEEP_AWAKE_TZ: 'UTC' });
    expect(env.KEEP_AWAKE_HOURS).toBe('07-24');
  });

  it('rejects a malformed window or an unknown zone at boot', () => {
    expect(() => loadEnv({ KEEP_AWAKE_HOURS: '7am-midnight' })).toThrow(/KEEP_AWAKE_HOURS/);
    expect(() => loadEnv({ KEEP_AWAKE_HOURS: '7-25' })).toThrow(/KEEP_AWAKE_HOURS/);
    expect(() => loadEnv({ KEEP_AWAKE_TZ: 'Mars/Olympus' })).toThrow(/KEEP_AWAKE_TZ/);
  });
});

describe('auto-pause thresholds (D104)', () => {
  it('default to 20 jobs over 30 days, and are configurable within bounds', () => {
    expect(loadEnv({})).toMatchObject({ AUTO_PAUSE_MIN_COLLECTED: 20, AUTO_PAUSE_WINDOW_DAYS: 30 });
    expect(loadEnv({ AUTO_PAUSE_MIN_COLLECTED: '50', AUTO_PAUSE_WINDOW_DAYS: '45' })).toMatchObject(
      { AUTO_PAUSE_MIN_COLLECTED: 50, AUTO_PAUSE_WINDOW_DAYS: 45 },
    );
    expect(() => loadEnv({ AUTO_PAUSE_WINDOW_DAYS: '3' })).toThrow(/AUTO_PAUSE_WINDOW_DAYS/);
    expect(() => loadEnv({ AUTO_PAUSE_MIN_COLLECTED: '0' })).toThrow(/AUTO_PAUSE_MIN_COLLECTED/);
  });
});
