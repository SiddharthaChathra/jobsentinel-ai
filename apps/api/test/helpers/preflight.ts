import './test-env';
import postgres from 'postgres';
import { pgSsl } from '@jobsentinel/config';

/**
 * Jest `globalSetup` for the e2e suites: proves the database is actually reachable before any
 * suite runs (D78).
 *
 * Each suite guards itself with `hasDb`, but that only checks the env vars are *present*. When
 * `DATABASE_URL` points at a Supabase project that has been paused or removed — which free-tier
 * projects are after a stretch of inactivity — every suite ran anyway and failed on its own
 * timeout, turning one environmental fact into dozens of unrelated-looking failures. One probe
 * here reports the cause once, in a sentence, and stops.
 */
export default async function preflight(): Promise<void> {
  const url = process.env.DATABASE_URL;
  // No env at all is a legitimate configuration: the suites skip themselves (docs 13).
  if (!url) return;

  const host = (/@([^:/?]+)/.exec(url)?.[1] ?? 'unknown host').trim();
  const sql = postgres(url, { ssl: pgSsl(url), prepare: false, max: 1, connect_timeout: 15 });
  try {
    await sql`select 1`;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `e2e preflight: DATABASE_URL is set but the database at ${host} is unreachable.\n` +
        `  ${reason}\n\n` +
        `  A Supabase free-tier project is paused after a stretch of inactivity and its\n` +
        `  subdomain stops resolving once it is removed. Restore or recreate the project, run\n` +
        `  \`pnpm db:migrate\` and \`pnpm db:seed\`, then re-run. To run only the suites that need\n` +
        `  no database, unset DATABASE_URL.`,
      // Keep the driver error attached as well as quoted, so nothing is lost (D69).
      { cause: err },
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
