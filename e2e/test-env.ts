import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertTestTarget } from '@jobsentinel/config';

/**
 * Browser tests read the same generated file as the API e2e suites — `apps/api/.env.test`,
 * written by `pnpm test:db:start` for the LOCAL Supabase stack — and refuse to run against
 * anything else (F1, D101). Values are never printed.
 */
const file = resolve(__dirname, '../apps/api/.env.test');

export function loadTestEnv(): Record<string, string> {
  if (!existsSync(file)) {
    throw new Error('apps/api/.env.test is missing: run `pnpm test:db:start` first.');
  }
  const env: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]!] = m[2]!.replace(/^"(.*)"$/, '$1');
  }
  // Throws on any non-local database or the named production project (F1).
  assertTestTarget({
    DATABASE_URL: env.DATABASE_URL,
    DATABASE_DIRECT_URL: env.DATABASE_DIRECT_URL,
    SUPABASE_URL: env.SUPABASE_URL,
    PRODUCTION_SUPABASE_REF: env.PRODUCTION_SUPABASE_REF ?? process.env.PRODUCTION_SUPABASE_REF,
  });
  return env;
}

export const WEB_URL = 'http://localhost:3000';
export const API_URL = 'http://localhost:4000';
/** Every row the browser suite creates carries this word, so it can find and remove them. */
export const TAG = 'Zorblax';
