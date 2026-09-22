import 'reflect-metadata';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';

/**
 * Removes fixtures left behind when an e2e run is killed before its `afterAll` (`pnpm clean:test`).
 *
 * Every suite tags its data with `<suite>-<timestamp>`, so the fixtures are identifiable without
 * touching real rows. Run with `--dry` to see what would go. This exists because a killed test
 * run once left 24 fixture jobs scoring 100 % at the top of the real dashboard.
 */
const COMPANY_PATTERN = '^(jobsapi|match|notif|ingest|classif|valid|review|onboard|db|sources)-[0-9]+';
const TEST_EMAIL = '%@jobsentinel.test';

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry');
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  try {
    const companies = await sql<{ id: string; name: string }[]>`
      select id, name from companies where name ~ ${COMPANY_PATTERN}`;
    const users = await sql<{ id: string; email: string }[]>`
      select id, email from users where email like ${TEST_EMAIL}`;
    const [jobCount] = await sql<{ n: number }[]>`
      select count(*)::int as n from jobs
      where company_id in (select id from companies where name ~ ${COMPANY_PATTERN})`;

    console.warn(
      JSON.stringify({
        mode: dry ? 'dry-run' : 'delete',
        companies: companies.length,
        jobs: jobCount?.n ?? 0,
        users: users.length,
      }),
    );
    if (dry || (companies.length === 0 && users.length === 0)) return;

    // Children first: saved_jobs and applications reference jobs ON DELETE RESTRICT.
    for (const user of users) {
      await sql`delete from applications where user_id = ${user.id}`;
      await sql`delete from saved_jobs where user_id = ${user.id}`;
      await sql`delete from notifications where user_id = ${user.id}`;
      await sql`delete from users where id = ${user.id}`;
      const { error } = await admin.auth.admin.deleteUser(user.id);
      if (error && !/not found/i.test(error.message)) {
        console.warn(`auth delete ${user.email}: ${error.message}`);
      }
    }

    if (companies.length > 0) {
      const ids = companies.map((c) => c.id);
      await sql`delete from applications where job_id in (select id from jobs where company_id in ${sql(ids)})`;
      await sql`delete from saved_jobs where job_id in (select id from jobs where company_id in ${sql(ids)})`;
      await sql`delete from jobs where company_id in ${sql(ids)}`;
      await sql`delete from companies where id in ${sql(ids)}`;
    }

    const [left] = await sql<{ n: number }[]>`select count(*)::int as n from jobs`;
    console.warn(`removed. jobs remaining: ${left?.n ?? 0}`);
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
