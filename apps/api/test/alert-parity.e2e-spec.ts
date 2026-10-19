import './helpers/test-env';
import { Test } from '@nestjs/testing';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { and, eq, inArray } from 'drizzle-orm';
import { JobsQuery } from '@jobsentinel/types';
import { normalizeCompanyName } from '@jobsentinel/validation';
import { DB, type Db } from '../src/common/db/db.module';
import {
  companies,
  jobMatches,
  jobs,
  notificationSettings,
  notifications,
  preferences,
  telegramLinks,
  users,
} from '../src/common/db/schema';
import { HTTP_CLIENT } from '../src/common/http/http.module';
import { JobsQueryService } from '../src/jobs/jobs-query.service';
import { DigestService } from '../src/notifications/digest.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { TelegramClient } from '../src/notifications/telegram.client';
import { WorkerModule } from '../src/worker.module';
import { FakeHttpClient } from './helpers/fake-http';

/**
 * Dashboard/Telegram parity (R4, D127): for the same jobs and the same user, the jobs Telegram
 * picks (instant ∪ digest) are exactly the jobs the dashboard lists. Every kind of job that one
 * side once let through and the other did not is seeded here; this test fails the moment the two
 * diverge again. Audit 2026-10-18 defect 2.
 */
const hasDb = Boolean(process.env.DATABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const describeIf = hasDb ? describe : describe.skip;

class SilentTelegram {
  configured = true;
  botUsername = 'testbot';
  linkUrl(code: string) {
    return `https://t.me/testbot?start=${code}`;
  }
  sendMessage() {
    return Promise.resolve({ messageId: 1 });
  }
  answerCallbackQuery() {
    return Promise.resolve();
  }
}

describeIf('dashboard and Telegram pick the same jobs (R4, D127)', () => {
  const tag = `parity-${Date.now()}`;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let db: Db;
  let admin: SupabaseClient;
  let userId: string;
  let companyId: string;
  const ids: Record<string, string> = {};

  const seed = async (key: string, over: Partial<typeof jobs.$inferInsert> = {}) => {
    const [row] = await db
      .insert(jobs)
      .values({
        companyId,
        title: `${tag} ${key}`,
        normalizedTitle: `${tag} ${key}`.toLowerCase(),
        category: 'SOFTWARE',
        sourceUrl: `https://boards.example/${tag}/${key}`,
        applicationUrl: `https://boards.example/${tag}/${key}`,
        dedupeKey: `${tag}-${key}`,
        status: 'MATCHED',
        validationStatus: 'VALID',
        experienceLevel: 'FRESHER',
        experienceMinYears: '0',
        fresherEligible: true,
        employmentType: 'FULL_TIME',
        locationCity: 'Bengaluru',
        locationCountry: 'India',
        locationText: 'Bengaluru, India',
        firstSeenAt: new Date(),
        ...over,
      })
      .returning({ id: jobs.id });
    ids[key] = row!.id;
    await db.insert(jobMatches).values({
      jobId: row!.id,
      userId,
      profileVersion: 1,
      overallScore: 95,
      skillScore: 95,
      roleScore: 95,
      experienceScore: 100,
      locationScore: 100,
      priority: 'VERY_HIGH',
      matchedSkills: ['Java'],
      missingSkills: [],
      explanation: 'parity',
    });
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(HTTP_CLIENT)
      .useValue(new FakeHttpClient({}))
      .overrideProvider(TelegramClient)
      .useValue(new SilentTelegram())
      .compile();
    db = moduleRef.get(DB);
    admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const created = await admin.auth.admin.createUser({
      email: `${tag}@jobsentinel.test`,
      password: `P-${Math.random().toString(36).slice(2)}-Pass1!`,
      email_confirm: true,
    });
    if (created.error) throw new Error(created.error.message);
    userId = created.data.user!.id;
    await db
      .insert(users)
      .values({ id: userId, email: `${tag}@jobsentinel.test`, profileVersion: 1 });
    await db.insert(preferences).values({
      userId,
      timezone: 'Asia/Kolkata',
      locations: ['India'],
      employmentTypes: ['FULL_TIME', 'TRAINEE'],
    });
    await db
      .insert(notificationSettings)
      .values({ userId, mode: 'BOTH', instantMinScore: 0, telegramEnabled: true });
    await db
      .insert(telegramLinks)
      .values({ userId, chatId: BigInt(995000000 + (Date.now() % 100000)), linkedAt: new Date() });
    const [c] = await db
      .insert(companies)
      .values({ name: `${tag} Co`, normalizedName: normalizeCompanyName(`${tag} Co`) })
      .returning({ id: companies.id });
    companyId = c!.id;

    // Listed by the dashboard, so Telegram may pick them.
    await seed('eligible');
    await seed('trainee', { employmentType: 'TRAINEE' });
    await seed('remoteAbroad', {
      locationCity: null,
      locationCountry: 'United States',
      locationText: 'Remote, US',
      isRemote: true,
    });
    await seed('ambiguousFresher', {
      experienceLevel: 'ENTRY_LEVEL',
      experienceMinYears: null,
      fresherEligible: null,
    });
    // Not listed, so Telegram must not pick them either — each was once let through by one side.
    await seed('internshipNotChosen', { employmentType: 'INTERNSHIP' });
    await seed('experienced', {
      experienceLevel: 'EXPERIENCED',
      experienceMinYears: '4',
      fresherEligible: false,
    });
    await seed('onsiteAbroad', {
      locationCity: 'Austin',
      locationCountry: 'United States',
      locationText: 'Austin, TX',
    });
    await seed('held', { status: 'NEEDS_REVIEW', holdReason: 'experience unknown' });
    await seed('placeholder', { status: 'PLACEHOLDER' });
    await seed('closed', { closedAt: new Date() });
    await seed('unconfirmed', { validationStatus: 'NEEDS_REVIEW' });
  }, 180_000);

  afterAll(async () => {
    if (userId) await db.delete(notifications).where(eq(notifications.userId, userId));
    if (companyId) {
      const all = Object.values(ids);
      if (all.length) await db.delete(jobMatches).where(inArray(jobMatches.jobId, all));
      await db.delete(jobs).where(eq(jobs.companyId, companyId));
      await db.delete(companies).where(eq(companies.id, companyId));
    }
    if (userId) {
      await db.delete(users).where(eq(users.id, userId));
      await admin.auth.admin.deleteUser(userId);
    }
    await moduleRef.close();
  }, 180_000);

  it('the Telegram set (instant ∪ digest) equals the dashboard set, job for job', async () => {
    const seeded = new Set(Object.values(ids));
    const name = (id: string) => Object.entries(ids).find(([, v]) => v === id)![0];

    const listed = (
      await moduleRef.get(JobsQueryService).list(userId, JobsQuery.parse({ limit: 100 }), undefined)
    ).items
      .map((c) => c.id)
      .filter((id) => seeded.has(id));

    await moduleRef.get(NotificationsService).enqueuePending({ userIds: [userId] });
    const instant = (
      await db
        .select({ jobId: notifications.jobId })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            eq(notifications.type, 'INSTANT'),
            eq(notifications.channel, 'TELEGRAM'),
          ),
        )
    )
      .map((r) => r.jobId!)
      .filter((id) => seeded.has(id));
    const digest = (
      await moduleRef.get(DigestService).build(userId, 'Asia/Kolkata', true, new Date())
    ).jobs
      .map((j) => j.jobId)
      .filter((id) => seeded.has(id));

    const dashboard = listed.map(name).sort();
    const telegram = [...new Set([...instant, ...digest])].map(name).sort();
    expect(dashboard).toEqual(['ambiguousFresher', 'eligible', 'remoteAbroad', 'trainee']);
    expect(telegram).toEqual(dashboard);
  }, 120_000);
});
