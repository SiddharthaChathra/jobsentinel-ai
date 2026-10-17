/**
 * Where a database or Supabase URL points, and whether tests may touch it (F1, D101).
 *
 * The e2e suites, the test seed and the test reset all write and delete rows. They once ran
 * against the live project and corrupted real data four times (D46, D57, D68, D77). They now
 * run only against a local Supabase stack, or a project explicitly named as the test project,
 * and never against production, whatever else is configured.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal']);

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** A local database speaks plain TCP; every hosted one must use TLS. */
export function pgSsl(url: string): 'require' | false {
  const host = hostOf(url);
  return host !== null && LOCAL_HOSTS.has(host) ? false : 'require';
}

/**
 * The Supabase project ref a URL belongs to, or null. Covers the API host
 * (`<ref>.supabase.co`), the direct host (`db.<ref>.supabase.co`) and the pooler, whose host is
 * shared but whose user name is `postgres.<ref>`.
 */
export function supabaseRef(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const direct = /^(?:db\.)?([a-z0-9]{20})\.supabase\.(?:co|in)$/.exec(host);
  if (direct) return direct[1]!;
  const pooled = /^postgres\.([a-z0-9]{20})$/.exec(decodeURIComponent(parsed.username));
  return pooled ? pooled[1]! : null;
}

export type TestTargetEnv = Record<string, string | undefined>;

/** Every variable through which a test could reach a database or a Supabase project. */
export const TARGET_KEYS = ['DATABASE_URL', 'DATABASE_DIRECT_URL', 'SUPABASE_URL'] as const;

/**
 * Throws unless every configured target is local or the named test project. Production is
 * refused even when it is also named as the test project — a typo must not be enough.
 * Returns the checked URLs' hosts, for the caller's log line.
 */
export function assertTestTarget(env: TestTargetEnv): string[] {
  const production = env.PRODUCTION_SUPABASE_REF?.trim().toLowerCase() || null;
  const test = env.TEST_SUPABASE_REF?.trim().toLowerCase() || null;
  const checked: string[] = [];
  const problems: string[] = [];

  for (const key of TARGET_KEYS) {
    const url = env[key];
    if (!url) continue;
    const host = hostOf(url);
    if (host === null) {
      problems.push(`${key} is not a URL`);
      continue;
    }
    checked.push(host);
    const ref = supabaseRef(url);
    if (ref !== null && ref === production) {
      problems.push(`${key} points at the PRODUCTION project (${ref})`);
    } else if (LOCAL_HOSTS.has(host)) {
      continue;
    } else if (ref === null || ref !== test) {
      problems.push(
        `${key} points at ${ref ? `project ${ref}` : host}, which is neither local nor TEST_SUPABASE_REF`,
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Refusing to run against a non-test database (D101):\n  - ${problems.join('\n  - ')}\n` +
        `Tests read apps/api/.env.test only. Point it at the local stack (\`pnpm test:db:start\`) ` +
        `or a dedicated test project named in TEST_SUPABASE_REF.`,
    );
  }
  return checked;
}
