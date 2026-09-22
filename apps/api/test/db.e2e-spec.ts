import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/common/db/schema';
import {
  companies,
  jobSourceMappings,
  jobSources,
  jobs,
  notifications,
  users,
} from '../src/common/db/schema';

/**
 * Database-level guarantees (docs 02, 07, 10) verified against the live Supabase project:
 * unique notification per (user, job, channel, type), idempotent source mappings,
 * FOR UPDATE SKIP LOCKED leasing, updated_at trigger, and RLS isolation for a real user token.
 */
const hasDb = Boolean(process.env.DATABASE_DIRECT_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const describeIf = hasDb ? describe : describe.skip;

describeIf('database guarantees (integration)', () => {
  const client = postgres(process.env.DATABASE_DIRECT_URL!, {
    ssl: 'require',
    max: 4,
    prepare: false,
  });
  const db = drizzle(client, { schema });
  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const tag = `dbtest-${Date.now()}`;
  let userId: string;
  let otherUserId: string;
  let userToken: string;
  let companyId: string;
  let sourceIds: string[] = [];
  let jobId: string;

  beforeAll(async () => {
    const password = `Db-${Math.random().toString(36).slice(2)}-Pass1!`;
    const u1 = await admin.auth.admin.createUser({
      email: `${tag}-a@jobsentinel.test`,
      password,
      email_confirm: true,
    });
    const u2 = await admin.auth.admin.createUser({
      email: `${tag}-b@jobsentinel.test`,
      password,
      email_confirm: true,
    });
    const createErr = u1.error ?? u2.error;
    if (createErr) throw new Error(createErr.message);
    userId = u1.data.user.id;
    otherUserId = u2.data.user.id;
    await db.insert(users).values([
      { id: userId, email: `${tag}-a@jobsentinel.test` },
      { id: otherUserId, email: `${tag}-b@jobsentinel.test` },
    ]);
    const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    const signIn = await anon.auth.signInWithPassword({
      email: `${tag}-a@jobsentinel.test`,
      password,
    });
    userToken = signIn.data.session!.access_token;

    const [c] = await db
      .insert(companies)
      .values({ name: tag, normalizedName: tag })
      .returning({ id: companies.id });
    companyId = c!.id;
    const inserted = await db
      .insert(jobSources)
      .values(
        [1, 2, 3].map((i) => ({
          name: `${tag}-source-${i}`,
          type: 'ATS_API' as const,
          adapter: 'greenhouse',
          config: { boardToken: tag },
          companyId,
          nextScanAt: sql`now() - interval '1 minute'`,
        })),
      )
      .returning({ id: jobSources.id });
    sourceIds = inserted.map((r) => r.id);
    const [j] = await db
      .insert(jobs)
      .values({
        companyId,
        title: 'Test Engineer',
        normalizedTitle: 'test engineer',
        sourceUrl: 'https://example.com/j/1',
        dedupeKey: tag,
      })
      .returning({ id: jobs.id });
    jobId = j!.id;
  }, 60_000);

  afterAll(async () => {
    if (jobId) await db.delete(jobs).where(eq(jobs.id, jobId));
    if (sourceIds.length) await db.delete(jobSources).where(sql`${jobSources.id} in ${sourceIds}`);
    if (companyId) await db.delete(companies).where(eq(companies.id, companyId));
    for (const id of [userId, otherUserId]) if (id) await admin.auth.admin.deleteUser(id);
    await client.end({ timeout: 5 });
  }, 60_000);

  it('never stores two INSTANT notifications for the same user/job/channel', async () => {
    const row = { userId, jobId, channel: 'TELEGRAM' as const, type: 'INSTANT' as const };
    const first = await db
      .insert(notifications)
      .values(row)
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    const second = await db
      .insert(notifications)
      .values(row)
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    // a different channel for the same job is allowed (web inbox mirror)
    const web = await db
      .insert(notifications)
      .values({ ...row, channel: 'WEB' })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    expect(web).toHaveLength(1);
  });

  it('allows only one digest per user, channel and day', async () => {
    const row = {
      userId,
      channel: 'TELEGRAM' as const,
      type: 'DIGEST' as const,
      digestDate: '2026-09-22',
    };
    await db.insert(notifications).values(row);
    await expect(db.insert(notifications).values(row)).rejects.toThrow();
    const count = await db.$count(
      notifications,
      and(eq(notifications.userId, userId), eq(notifications.type, 'DIGEST')),
    );
    expect(count).toBe(1);
  });

  it('upserts job_source_mappings idempotently by (source_id, external_id)', async () => {
    const sourceId = sourceIds[0]!;
    const values = { jobId, sourceId, externalId: 'ext-1', sourceUrl: 'https://example.com/j/1' };
    await db
      .insert(jobSourceMappings)
      .values(values)
      .onConflictDoUpdate({
        target: [jobSourceMappings.sourceId, jobSourceMappings.externalId],
        set: { lastSeenAt: new Date() },
      });
    await db
      .insert(jobSourceMappings)
      .values(values)
      .onConflictDoUpdate({
        target: [jobSourceMappings.sourceId, jobSourceMappings.externalId],
        set: { lastSeenAt: new Date() },
      });
    const rows = await db
      .select()
      .from(jobSourceMappings)
      .where(
        and(eq(jobSourceMappings.sourceId, sourceId), eq(jobSourceMappings.externalId, 'ext-1')),
      );
    expect(rows).toHaveLength(1);
  });

  it('leases due sources with FOR UPDATE SKIP LOCKED so two workers never take the same source', async () => {
    const lease = (tx: typeof db, limit: number) =>
      tx.execute<{ id: string }>(sql`
        update job_sources set lease_until = now() + interval '5 minutes', last_attempted_scan = now()
        where id in (
          select id from job_sources
          where enabled and status <> 'DISABLED' and next_scan_at <= now()
            and (lease_until is null or lease_until < now())
            and name like ${`${tag}-source-%`}
          order by next_scan_at
          limit ${limit}
          for update skip locked
        ) returning id`);

    // Two overlapping transactions: the second must skip the rows locked by the first.
    let releaseFirst!: () => void;
    const firstDone = new Promise<void>((r) => (releaseFirst = r));
    const firstIds: string[] = [];
    const tx1 = db.transaction(async (tx) => {
      const rows = await lease(tx as unknown as typeof db, 2);
      firstIds.push(...rows.map((r) => r.id));
      await firstDone;
    });
    await new Promise((r) => setTimeout(r, 300));
    const secondIds = await db.transaction(async (tx) =>
      (await lease(tx as unknown as typeof db, 3)).map((r) => r.id),
    );
    releaseFirst();
    await tx1;

    expect(firstIds).toHaveLength(2);
    expect(secondIds).toHaveLength(1);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(3);
  }, 20_000);

  it('maintains updated_at through the trigger', async () => {
    const before = await db.query.companies.findFirst({ where: eq(companies.id, companyId) });
    await new Promise((r) => setTimeout(r, 50));
    await db
      .update(companies)
      .set({ careersUrl: 'https://example.com/careers' })
      .where(eq(companies.id, companyId));
    const after = await db.query.companies.findFirst({ where: eq(companies.id, companyId) });
    expect(after!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime());
  });

  it('RLS: a user token sees only its own rows and can read shared tables', async () => {
    const asUser = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });
    const own = await asUser.from('users').select('id');
    expect(own.error).toBeNull();
    expect((own.data as { id: string }[] | null)?.map((r) => r.id)).toEqual([userId]);

    const notes = await asUser.from('notifications').select('user_id');
    expect(notes.data?.every((n) => n.user_id === userId)).toBe(true);

    const shared = await asUser.from('job_sources').select('id').eq('id', sourceIds[0]!);
    expect(shared.data).toHaveLength(1);

    const write = await asUser
      .from('job_sources')
      .update({ enabled: false })
      .eq('id', sourceIds[0]!)
      .select();
    expect(write.data).toHaveLength(0); // no write policy → silently no rows

    const system = await asUser.from('system_logs').select('id').limit(1);
    expect(system.data).toHaveLength(0); // no policy at all → service role only
  });
});
