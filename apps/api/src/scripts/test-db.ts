import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { assertEnv, assertTestTarget, loadEnv, pgSsl } from '@jobsentinel/config';
import { applyMigrations } from '../common/db/migrate';
import * as schema from '../common/db/schema';
import { seed } from '../common/db/seed';

/**
 * Prepares the TEST database (F1, D101): `pnpm test:db:seed` applies migrations and the seed;
 * `pnpm test:db:reset` first wipes the app schema and test users.
 *
 * Reads `apps/api/.env.test` only, and refuses to start unless every configured database is the
 * local stack or the project named in TEST_SUPABASE_REF — never production.
 */
async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== 'seed' && mode !== 'reset') {
    throw new Error('usage: test-db <seed|reset>');
  }
  const file = resolve(__dirname, '../../.env.test');
  if (!existsSync(file)) {
    throw new Error('apps/api/.env.test is missing — run `pnpm test:db:start` (writes it) first.');
  }
  config({ path: file, override: true, quiet: true });
  const hosts = assertTestTarget(process.env);
  const env = loadEnv();
  assertEnv(env, ['DATABASE_DIRECT_URL']);
  console.warn(`test-db ${mode}: target ${[...new Set(hosts)].join(', ')}`);

  const url = env.DATABASE_DIRECT_URL;
  if (mode === 'reset') {
    const sql = postgres(url, { ssl: pgSsl(url), max: 1, prepare: false });
    try {
      // App tables and drizzle's journal go; Supabase's own schemas (auth, storage) stay.
      await sql.unsafe(`
        drop schema if exists drizzle cascade;
        drop schema if exists public cascade;
        create schema public;
        grant usage on schema public to postgres, anon, authenticated, service_role;
        grant all on schema public to postgres, service_role;
        alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
        alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
        alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
        delete from auth.users;
      `);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  await applyMigrations(url);
  const client = postgres(url, { ssl: pgSsl(url), max: 1, prepare: false });
  try {
    const r = await seed(drizzle(client, { schema }));
    console.warn(
      `test-db ${mode}: migrated; seeded ${r.skills} skills, ${r.companies} companies, ${r.sources} sources`,
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
