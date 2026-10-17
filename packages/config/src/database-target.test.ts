import { assertTestTarget, pgSsl, supabaseRef } from './database-target';

const PROD = 'hktrhvorwsymventjhfu';
const TEST = 'abcdefghijklmnopqrst';
const pooler = (ref: string) =>
  `postgresql://postgres.${ref}:pw@aws-1-ap-south-1.pooler.supabase.com:6543/postgres`;

describe('supabaseRef', () => {
  it('reads the ref from API, direct and pooler URLs', () => {
    expect(supabaseRef(`https://${PROD}.supabase.co`)).toBe(PROD);
    expect(supabaseRef(`postgresql://postgres:pw@db.${PROD}.supabase.co:5432/postgres`)).toBe(PROD);
    expect(supabaseRef(pooler(PROD))).toBe(PROD);
    expect(supabaseRef('postgresql://postgres:postgres@127.0.0.1:54322/postgres')).toBeNull();
    expect(supabaseRef('not a url')).toBeNull();
  });
});

describe('pgSsl', () => {
  it('requires TLS everywhere except a local database', () => {
    expect(pgSsl('postgresql://postgres:postgres@127.0.0.1:54322/postgres')).toBe(false);
    expect(pgSsl('postgresql://u:p@localhost:5432/db')).toBe(false);
    expect(pgSsl(pooler(PROD))).toBe('require');
    expect(pgSsl('garbage')).toBe('require');
  });
});

describe('assertTestTarget (F1, D101)', () => {
  const local = {
    DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    DATABASE_DIRECT_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    PRODUCTION_SUPABASE_REF: PROD,
  };

  it('accepts the local stack', () => {
    expect(assertTestTarget(local)).toEqual(['127.0.0.1', '127.0.0.1', '127.0.0.1']);
  });

  it('accepts a project explicitly named as the test project', () => {
    expect(() =>
      assertTestTarget({
        DATABASE_URL: pooler(TEST),
        SUPABASE_URL: `https://${TEST}.supabase.co`,
        TEST_SUPABASE_REF: TEST,
        PRODUCTION_SUPABASE_REF: PROD,
      }),
    ).not.toThrow();
  });

  it.each(['DATABASE_URL', 'DATABASE_DIRECT_URL', 'SUPABASE_URL'] as const)(
    'aborts when %s points at production',
    (key) => {
      const url = key === 'SUPABASE_URL' ? `https://${PROD}.supabase.co` : pooler(PROD);
      expect(() => assertTestTarget({ ...local, [key]: url })).toThrow(/PRODUCTION/);
    },
  );

  it('aborts on production even when it is also named as the test project', () => {
    expect(() =>
      assertTestTarget({
        DATABASE_URL: pooler(PROD),
        TEST_SUPABASE_REF: PROD,
        PRODUCTION_SUPABASE_REF: PROD,
      }),
    ).toThrow(/PRODUCTION/);
  });

  it('aborts on any hosted project that is not the named test project', () => {
    expect(() =>
      assertTestTarget({ DATABASE_URL: pooler('zzzzzzzzzzzzzzzzzzzz'), TEST_SUPABASE_REF: TEST }),
    ).toThrow(/neither local nor TEST_SUPABASE_REF/);
    // Even with no production ref configured, an unknown hosted database is refused.
    expect(() => assertTestTarget({ DATABASE_URL: pooler(PROD) })).toThrow(/neither local/);
  });

  it('aborts on a malformed URL rather than guessing', () => {
    expect(() => assertTestTarget({ DATABASE_URL: 'nonsense' })).toThrow(/not a URL/);
  });
});
