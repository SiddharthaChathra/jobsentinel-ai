import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { assertEnv, loadEnv } from '@jobsentinel/config';

/** Applies pending SQL migrations. Run manually: `pnpm db:migrate`. */
async function main(): Promise<void> {
  const env = loadEnv();
  assertEnv(env, ['DATABASE_DIRECT_URL']);
  const sql = postgres(env.DATABASE_DIRECT_URL, { ssl: 'require', max: 1, prepare: false });
  try {
    await migrate(drizzle(sql), { migrationsFolder: `${__dirname}/migrations` });
    console.warn('migrations applied');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
