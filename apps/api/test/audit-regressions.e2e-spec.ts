import './helpers/test-env';
import { Test } from '@nestjs/testing';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AIRequest, AIResult, AIService } from '@jobsentinel/ai';
import { JobsQuery } from '@jobsentinel/types';
import { normalizeCompanyName } from '@jobsentinel/validation';
import { AI_SERVICE } from '../src/common/ai/ai.module';
import { DB, type Db } from '../src/common/db/db.module';
import {
  applications,
  companies,
  jobMatches,
  jobSources,
  jobs,
  notificationSettings,
  notifications,
  preferences,
  preferredRoles,
  profileSkills,
  profiles,
  reminders,
  savedJobs,
  skills,
  telegramLinks,
  users,
} from '../src/common/db/schema';
import { HTTP_CLIENT } from '../src/common/http/http.module';
import { ClassificationService } from '../src/jobs/classification.service';
import { JobsQueryService } from '../src/jobs/jobs-query.service';
import { SkillGapsService } from '../src/jobs/skill-gaps.service';
import { TrackerService } from '../src/jobs/tracker.service';
import { MatchingService } from '../src/matching/matching.service';
import { DispatcherService } from '../src/notifications/dispatcher.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { RemindersService } from '../src/notifications/reminders.service';
import { TelegramClient } from '../src/notifications/telegram.client';
import { WeeklySummaryService } from '../src/notifications/weekly-summary.service';
import type { FetchContext, JobSource, RawJob, SourceMetadata } from '../src/sources/job-source';
import { SourceManager } from '../src/sources/source-manager';
import { SourceRegistry } from '../src/sources/source-registry';
import { SchedulerService } from '../src/scheduler/scheduler.service';
import { ValidationOrchestrator } from '../src/validation/validation.orchestrator';
import { WorkerModule } from '../src/worker.module';
import { FakeHttpClient } from './helpers/fake-http';

/**
 * Regression tests for the 2026-10-18 audit (docs/verification-report.md), through the real
 * pipeline: a fixture source, no AI, a fake Telegram. Defect 1 (D126), defects 2-3 (D127, with
 * alert-parity.e2e-spec.ts), defect 6 (D128), the X1 journey and X6 row-level security.
 */
const hasDb = Boolean(process.env.DATABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const describeIf = hasDb ? describe : describe.skip;
const DAY = 86_400_000;

class FakeTelegram {
  sent: { text: string; buttons?: unknown }[] = [];
  configured = true;
  botUsername = 'testbot';
  linkUrl(code: string) {
    return `https://t.me/testbot?start=${code}`;
  }
  sendMessage(input: { text: string; buttons?: unknown }) {
    this.sent.push({ text: input.text, buttons: input.buttons });
    return Promise.resolve({ messageId: this.sent.length });
  }
  answerCallbackQuery() {
    return Promise.resolve();
  }
}

class NoAi {
  run<T>(_req: AIRequest<T>): Promise<AIResult<T>> {
    return Promise.resolve({ status: 'ERROR', error: 'no AI in this test' } as AIResult<T>);
  }
}

class FixtureAdapter implements JobSource<{ key: string }> {
  readonly metadata: SourceMetadata = {
    adapter: 'regression-fixture',
    label: 'Regression fixture',
    type: 'ATS_API',
    defaultPriority: 'NORMAL',
    supportsSince: false,
    supportsCursor: false,
    politenessMs: 0,
    minIntervalSec: 1,
  };
  readonly configSchema = z.object({ key: z.string() });
  jobs: RawJob[] = [];
  validateSource() {
    return Promise.resolve({ ok: true, message: 'ok' });
  }
  async *fetchJobs(_c: { key: string }, _ctx: FetchContext): AsyncIterable<RawJob> {
    for (const j of this.jobs) yield j;
  }
}

describeIf('audit regressions (2026-10-18)', () => {
  const tag = `regr${Date.now()}`;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let db: Db;
  let admin: SupabaseClient;
  const telegram = new FakeTelegram();
  const adapter = new FixtureAdapter();
  const userIds: Record<'a' | 'b', string> = { a: '', b: '' };
  const passwords: Record<'a' | 'b', string> = { a: '', b: '' };
  let companyId: string;
  let sourceId: string;

  const routes = {
    [`https://boards.greenhouse.io/${tag}/jobs/1`]: {
      body: '<html><body><h1>Software Engineer Trainee</h1><form><input type="file" name="resume"><button>Apply</button></form></body></html>',
    },
    [`https://${tag}.example`]: { body: `<html><body>${tag} Labs</body></html>` },
  };

  const makeUser = async (key: 'a' | 'b') => {
    const email = `${tag}-${key}@jobsentinel.test`;
    passwords[key] = `Rg-${Math.random().toString(36).slice(2)}-Pass1!`;
    const created = await admin.auth.admin.createUser({
      email,
      password: passwords[key],
      email_confirm: true,
    });
    if (created.error) throw new Error(created.error.message);
    const id = created.data.user!.id;
    await db.insert(users).values({ id, email, profileVersion: 1 });
    const [profile] = await db
      .insert(profiles)
      .values({
        userId: id,
        experienceLevel: 'FRESHER',
        graduationYear: 2027,
        summary: 'CS student',
      })
      .returning({ id: profiles.id });
    // Preferences with the schema defaults (job types FULL_TIME + TRAINEE, D127).
    await db
      .insert(preferences)
      .values({ userId: id, timezone: 'Asia/Kolkata', graduationYear: 2027 });
    await db
      .insert(notificationSettings)
      .values({ userId: id, mode: 'BOTH', instantMinScore: 0, telegramEnabled: true });
    await db.insert(telegramLinks).values({
      userId: id,
      chatId: BigInt(994000000 + (Date.now() % 100000)) + BigInt(key === 'a' ? 0 : 7),
      linkedAt: new Date(),
    });
    await db.insert(preferredRoles).values({
      userId: id,
      title: 'Software Engineer',
      normalizedTitle: 'software engineer',
      roleFamily: 'software_engineer',
      tier: 'PRIMARY',
    });
    for (const name of ['Java', 'Python']) {
      const [s] = await db
        .insert(skills)
        .values({ name, normalizedName: name.toLowerCase(), category: 'LANGUAGE' })
        .onConflictDoUpdate({ target: skills.normalizedName, set: { updatedAt: new Date() } })
        .returning({ id: skills.id });
      await db
        .insert(profileSkills)
        .values({ profileId: profile!.id, skillId: s!.id, origin: 'USER' })
        .onConflictDoNothing();
    }
    return id;
  };

  const scan = async (raw: RawJob[]) => {
    adapter.jobs = raw;
    await db.update(jobSources).set({ leaseUntil: null }).where(eq(jobSources.id, sourceId));
    const [source] = await moduleRef.get(SchedulerService).leaseDueSources(1, [sourceId]);
    return moduleRef.get(SourceManager).runScan(source!, 'MANUAL');
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(HTTP_CLIENT)
      .useValue(new FakeHttpClient(routes))
      .overrideProvider(AI_SERVICE)
      .useValue(new NoAi() as unknown as AIService)
      .overrideProvider(TelegramClient)
      .useValue(telegram)
      .compile();
    db = moduleRef.get(DB);
    moduleRef.get(SourceRegistry).register(adapter as unknown as JobSource<unknown>);
    admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    userIds.a = await makeUser('a');
    userIds.b = await makeUser('b');
    const [c] = await db
      .insert(companies)
      .values({
        name: `${tag} Labs`,
        normalizedName: normalizeCompanyName(`${tag} Labs`),
        websiteDomain: `${tag}.example`,
        atsProvider: 'greenhouse',
        atsSlug: tag,
        isTrusted: true,
        verificationStatus: 'VERIFIED',
      })
      .returning({ id: companies.id });
    companyId = c!.id;
    const [s] = await db
      .insert(jobSources)
      .values({
        name: `${tag} board`,
        type: 'ATS_API',
        adapter: 'regression-fixture',
        config: { key: 'x' },
        companyId,
        nextScanAt: new Date(),
      })
      .returning({ id: jobSources.id });
    sourceId = s!.id;
  }, 180_000);

  afterAll(async () => {
    for (const id of Object.values(userIds).filter(Boolean)) {
      await db.delete(notifications).where(eq(notifications.userId, id));
      await db.delete(reminders).where(eq(reminders.userId, id));
      await db.delete(applications).where(eq(applications.userId, id));
      await db.delete(savedJobs).where(eq(savedJobs.userId, id));
    }
    if (sourceId) await db.delete(jobSources).where(eq(jobSources.id, sourceId));
    if (companyId) {
      const ids = (
        await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.companyId, companyId))
      ).map((r) => r.id);
      if (ids.length) await db.delete(jobMatches).where(inArray(jobMatches.jobId, ids));
      await db.delete(jobs).where(eq(jobs.companyId, companyId));
      await db.delete(companies).where(eq(companies.id, companyId));
    }
    // Anything else carrying this run's tag (e.g. a company row the old code would have made).
    await db.execute(
      sql`delete from job_matches where job_id in (select id from jobs where source_url like ${`%/${tag}/%`})`,
    );
    await db.execute(sql`delete from jobs where source_url like ${`%/${tag}/%`}`);
    await db.execute(
      sql`delete from companies where normalized_name like ${`${tag.toLowerCase()}%`} and not exists (select 1 from jobs j where j.company_id = companies.id)`,
    );
    for (const id of Object.values(userIds).filter(Boolean)) {
      await db.delete(users).where(eq(users.id, id));
      await admin.auth.admin.deleteUser(id);
    }
    await moduleRef.close();
  }, 180_000);

  it('defect 1 (D126): R2 phrases through real ingestion — "3+ years preferred" is never a fresher role', async () => {
    const phrases: [string, string][] = [
      ['Open to 2025 passouts only. Freshers can apply.', 'FILTERED_OUT'],
      ['Hiring the 2026 batch only. Freshers.', 'FILTERED_OUT'],
      ['Eligible: 2025/2026/2027 batch. Freshers welcome.', 'CLASSIFIED'],
      ['Freshers welcome, 3+ years preferred. Java.', 'FILTERED_OUT'],
      ['Freshers welcome. 3+ years desirable.', 'FILTERED_OUT'],
      ['Entry-level role for recent graduates. Java and SQL.', 'CLASSIFIED'],
    ];
    await scan(
      phrases.map(([d], i) => ({
        externalId: `${tag}-r2-${i}`,
        title: `Software Engineer R2 ${i}`,
        locationText: 'Pune, India',
        descriptionHtml: `<p>${d}</p>`,
        sourceUrl: `https://boards.example/${tag}/r2/${i}`,
        applicationUrl: `https://boards.example/${tag}/r2/${i}`,
        postedAt: new Date(),
      })),
    );
    const rows = await db
      .select()
      .from(jobs)
      .where(sql`${jobs.title} like 'Software Engineer R2 %'`);
    await moduleRef
      .get(ClassificationService)
      .classifyPending({ batch: 20, maxAiCalls: 0, jobIds: rows.map((r) => r.id) });
    const after = await db
      .select({ title: jobs.title, status: jobs.status, level: jobs.experienceLevel })
      .from(jobs)
      .where(
        inArray(
          jobs.id,
          rows.map((r) => r.id),
        ),
      );
    for (const [i, [phrase, expected]] of phrases.entries()) {
      const row = after.find((r) => r.title === `Software Engineer R2 ${i}`)!;
      expect({ phrase, status: row.status }).toEqual({ phrase, status: expected });
    }
  }, 120_000);

  it('defect 6 (D128): a posting under the board\'s own name ("<X> Careers") lands on the board\'s company', async () => {
    await scan([
      {
        externalId: `${tag}-careers`,
        title: 'Backend Engineer',
        companyName: `${tag} Labs Careers`,
        locationText: 'Bengaluru, India',
        descriptionHtml: '<p>0-1 years. Java.</p>',
        sourceUrl: `https://boards.example/${tag}/careers`,
        applicationUrl: `https://boards.example/${tag}/careers`,
        postedAt: new Date(),
      },
    ]);
    const [row] = await db
      .select({ companyId: jobs.companyId })
      .from(jobs)
      .where(
        sql`${jobs.title} = 'Backend Engineer' and ${jobs.sourceUrl} = ${`https://boards.example/${tag}/careers`}`,
      );
    expect(row!.companyId).toBe(companyId);
  }, 120_000);

  it('X1: one trainee job end to end — scan, classify, validate, match, Telegram, dashboard, applied, reminder, weekly, skill gaps', async () => {
    const summary = await scan([
      {
        externalId: `${tag}-x1`,
        title: 'Software Engineer Trainee',
        locationText: 'Bengaluru, India',
        descriptionHtml:
          '<p>2027 batch. Freshers welcome, 0 years of experience. Java, Python, SQL and Docker.</p>',
        sourceUrl: `https://boards.greenhouse.io/${tag}/jobs/1`,
        applicationUrl: `https://boards.greenhouse.io/${tag}/jobs/1`,
        postedAt: new Date(),
      },
    ]);
    expect(summary.status).toBe('SUCCEEDED');
    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.sourceUrl, `https://boards.greenhouse.io/${tag}/jobs/1`));
    const jobId = job!.id;
    expect(job).toMatchObject({ locationCountry: 'India', employmentType: 'TRAINEE' });

    await moduleRef
      .get(ClassificationService)
      .classifyPending({ batch: 10, maxAiCalls: 0, jobIds: [jobId] });
    await moduleRef
      .get(ValidationOrchestrator)
      .validatePending({ batch: 5, maxAiCalls: 0, jobIds: [jobId] });
    expect((await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) }))!).toMatchObject({
      status: 'VALID',
      category: 'SOFTWARE',
      experienceLevel: 'FRESHER',
    });

    await moduleRef
      .get(MatchingService)
      .matchPending({ batch: 10, maxAiCalls: 2, userIds: [userIds.a], jobIds: [jobId] });
    const [m] = await db.select().from(jobMatches).where(eq(jobMatches.jobId, jobId));
    expect(m).toMatchObject({ scoring: 'RULES_ONLY' }); // no AI: the rules score stands (F8)

    await moduleRef.get(NotificationsService).enqueuePending({ userIds: [userIds.a] });
    const before = telegram.sent.length;
    await moduleRef.get(DispatcherService).dispatchPending({ batch: 50 });
    const msg = telegram.sent
      .slice(before)
      .find((t) => t.text.includes('Software Engineer Trainee'));
    expect(JSON.stringify(msg?.buttons)).toContain(`https://boards.greenhouse.io/${tag}/jobs/1`);

    // Defects 2-3: Telegram alerted it, so the dashboard (default FULL_TIME + TRAINEE) lists it.
    const list = await moduleRef
      .get(JobsQueryService)
      .list(userIds.a, JobsQuery.parse({}), undefined);
    expect(list.items.some((c) => c.id === jobId)).toBe(true);

    await moduleRef.get(TrackerService).upsert(userIds.a, jobId, { status: 'APPLIED' });
    await db
      .update(applications)
      .set({ lastStatusChangeAt: new Date(Date.now() - 8 * DAY) })
      .where(eq(applications.jobId, jobId));
    const today = new Date();
    const daytime = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 6, 0),
    );
    await moduleRef.get(RemindersService).plan({ now: daytime, userIds: [userIds.a] });
    expect(
      (await moduleRef.get(RemindersService).deliver({ now: daytime, userIds: [userIds.a] })).sent,
    ).toBe(1);

    const weekly = await moduleRef
      .get(WeeklySummaryService)
      .build(
        userIds.a,
        1,
        { from: new Date(Date.now() - 7 * DAY), to: new Date(Date.now() + 3_600_000) },
        new Date(),
        'Asia/Kolkata',
      );
    expect(weekly).toMatchObject({ newJobs: { total: 1 }, applications: { applied: 1 } });
    const gaps = await moduleRef.get(SkillGapsService).report(userIds.a);
    expect(gaps.basedOn).toBe(1);
    expect(gaps.gaps.map((g) => g.skill)).toEqual(expect.arrayContaining(['SQL']));
  }, 180_000);

  it("X6: user A's token cannot read user B's rows in any per-user table", async () => {
    const b = userIds.b;
    const [j] = await db
      .insert(jobs)
      .values({
        companyId,
        title: 'RLS Job',
        normalizedTitle: 'rls job',
        sourceUrl: `https://boards.example/${tag}/rls`,
        dedupeKey: `${tag}-rls`,
      })
      .returning({ id: jobs.id });
    await db.insert(jobMatches).values({
      jobId: j!.id,
      userId: b,
      profileVersion: 1,
      overallScore: 80,
      skillScore: 80,
      roleScore: 80,
      experienceScore: 100,
      locationScore: 100,
      priority: 'HIGH',
      matchedSkills: [],
      missingSkills: [],
      explanation: 'rls',
    });
    await db.insert(applications).values({ userId: b, jobId: j!.id, status: 'APPLIED' });
    await db.insert(savedJobs).values({ userId: b, jobId: j!.id });
    await db.insert(reminders).values({
      userId: b,
      jobId: j!.id,
      kind: 'FOLLOW_UP',
      anchor: 'x',
      idempotencyKey: `${tag}-rls`,
      dueAt: new Date(),
    });
    await db.insert(notifications).values({
      userId: b,
      jobId: null,
      channel: 'WEB',
      type: 'SYSTEM',
      payload: { title: 'b only' },
    });

    const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    const signed = await anon.auth.signInWithPassword({
      email: `${tag}-a@jobsentinel.test`,
      password: passwords.a,
    });
    if (signed.error) throw new Error(signed.error.message);
    for (const table of [
      'applications',
      'saved_jobs',
      'reminders',
      'job_matches',
      'notifications',
      'preferences',
      'profiles',
      'notification_settings',
      'telegram_links',
      'ai_usage',
    ]) {
      const { data, error } = await anon.from(table).select('user_id').eq('user_id', b);
      expect({ table, error: error?.message ?? null, visible: data?.length ?? 0 }).toEqual({
        table,
        error: null,
        visible: 0,
      });
    }
    expect(
      (await moduleRef.get(RemindersService).list(userIds.a, 60)).some((r) => r.job.id === j!.id),
    ).toBe(false);
  }, 120_000);
});
