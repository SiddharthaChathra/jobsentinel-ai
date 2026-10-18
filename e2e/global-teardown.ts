import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { loadTestEnv, TAG } from './test-env';

/**
 * Removes everything the browser suite created: its tagged jobs and company, and the throwaway
 * `zorblax-*@jobsentinel.test` users with their rows and resume files. Also run before seeding,
 * so a killed run never leaves duplicates behind.
 */
export async function cleanUp(env: Record<string, string>): Promise<void> {
  const sql = postgres(env.DATABASE_URL!, { max: 1 });
  const admin = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  try {
    const users = await sql<{ id: string }[]>`
      select id from users where email like ${`${TAG.toLowerCase()}-%@jobsentinel.test`}`;
    for (const { id } of users) {
      const files = await admin.storage.from(env.RESUME_BUCKET ?? 'resumes').list(id);
      if (files.data?.length) {
        await admin.storage
          .from(env.RESUME_BUCKET ?? 'resumes')
          .remove(files.data.map((f) => `${id}/${f.name}`));
      }
      // Tracker rows reference jobs with ON DELETE RESTRICT: remove them before the jobs.
      await sql`delete from applications where user_id = ${id}`;
      await sql`delete from saved_jobs where user_id = ${id}`;
      await sql`delete from users where id = ${id}`;
      await admin.auth.admin.deleteUser(id);
    }
    // An auth user whose app row was never created (a sign-up that failed half-way).
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of data?.users ?? []) {
      if (u.email?.startsWith(`${TAG.toLowerCase()}-`) && u.email.endsWith('@jobsentinel.test')) {
        await admin.auth.admin.deleteUser(u.id);
      }
    }
    await sql`delete from applications where job_id in (select id from jobs where dedupe_key like ${`${TAG}-%`})`;
    await sql`delete from saved_jobs where job_id in (select id from jobs where dedupe_key like ${`${TAG}-%`})`;
    await sql`delete from jobs where dedupe_key like ${`${TAG}-%`}`;
    await sql`delete from companies where name = ${`${TAG} Labs`}`;
  } finally {
    await sql.end();
  }
}

export default async function globalTeardown(): Promise<void> {
  await cleanUp(loadTestEnv());
}
