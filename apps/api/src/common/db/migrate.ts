import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { assertEnv, loadEnv, pgSsl } from '@jobsentinel/config';

/** Applies pending SQL migrations to the database at `url`. */
export async function applyMigrations(url: string): Promise<void> {
  const sql = postgres(url, { ssl: pgSsl(url), max: 1, prepare: false });
  try {
    await migrate(drizzle(sql), { migrationsFolder: `${__dirname}/migrations` });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Run manually: `pnpm db:migrate`. The package script passes `--env-file=.env`; this module no
 * longer loads dotenv itself, so importing it (as the test-database script does) cannot pull in
 * production settings (D101).
 */
async function main(): Promise<void> {
  const env = loadEnv();
  assertEnv(env, ['DATABASE_DIRECT_URL']);
  await applyMigrations(env.DATABASE_DIRECT_URL);
  console.warn('migrations applied');
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
