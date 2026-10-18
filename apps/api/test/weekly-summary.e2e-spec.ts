import './helpers/test-env';
import { Test } from '@nestjs/testing';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { and, eq, inArray } from 'drizzle-orm';
import { normalizeCompanyName, weeklySummaryWindow } from '@jobsentinel/validation';
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
  reminders,
  telegramLinks,
  users,
} from '../src/common/db/schema';
import { HTTP_CLIENT } from '../src/common/http/http.module';
import { DispatcherService } from '../src/notifications/dispatcher.service';
import { TelegramClient } from '../src/notifications/telegram.client';
import { WeeklySummaryService } from '../src/notifications/weekly-summary.service';
import { WorkerModule } from '../src/worker.module';
import { FakeHttpClient } from './helpers/fake-http';

/**
 * Weekly summary (F6, D121): sent once per week however often the worker runs, the counts are
 * right on a seeded week, only opted-in users get it, and it is due only from Sunday 09:00 local.
 * Telegram is faked; every call is scoped to this suite's users.
 */
const hasDb = Boolean(process.env.DATABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const describeIf = hasDb ? describe : describe.skip;

// Anchored to the most recent Sunday 09:00 IST, so the fixture stays inside the list's 60-day
// window whenever the suite runs. The summary covers the 7 days before the anchor.
const WINDOW = weeklySummaryWindow(new Date(), 'Asia/Kolkata');
const ANCHOR = WINDOW.to.getTime();
const DAY = 86_400_000;
const at = (offsetMs: number) => new Date(ANCHOR + offsetMs);
const SUNDAY_0930_IST = at(30 * 60_000);
const IN_WEEK = at(-3 * DAY);

class FakeTelegram {
  sent: { text: string }[] = [];
  configured = true;
  botUsername = 'testbot';
  linkUrl(code: string) {
    return `https://t.me/testbot?start=${code}`;
  }
  sendMessage(input: { text: string }) {
    this.sent.push({ text: input.text });
    return Promise.resolve({ messageId: this.sent.length });
  }
  answerCallbackQuery() {
    return Promise.resolve();
  }
}

describeIf('weekly summary (F6, D121)', () => {
  const tag = `weekly-${Date.now()}`;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let db: Db;
  let svc: WeeklySummaryService;
  let telegram: FakeTelegram;
  let admin: SupabaseClient;
  let userId: string;
  let optedOutId: string;
  let companyId: string;
  let sourceId: string;

  const createUser = async (suffix: string, weekly: boolean) => {
    const email = `${tag}-${suffix}@jobsentinel.test`;
    const created = await admin.auth.admin.createUser({
      email,
      password: `W-${Math.random().toString(36).slice(2)}-Pass1!`,
      email_confirm: true,
    });
    if (created.error) throw new Error(created.error.message);
    const id = created.data.user!.id;
    await db.insert(users).values({ id, email, profileVersion: 1 });
    await db.insert(preferences).values({ userId: id, timezone: 'Asia/Kolkata' });
    await db
      .insert(notificationSettings)
      .values({ userId: id, mode: 'BOTH', telegramEnabled: true, weeklySummaryEnabled: weekly });
    await db.insert(telegramLinks).values({
      userId: id,
      chatId: BigInt(997000000 + (Date.now() % 100000)) + BigInt(weekly ? 0 : 1),
      linkedAt: new Date(),
    });
    return id;
  };

  const seedJob = async (
    title: string,
    score: number,
    over: Partial<typeof jobs.$inferInsert> = {},
  ) => {
    const [row] = await db
      .insert(jobs)
      .values({
        companyId,
        title,
        normalizedTitle: title.toLowerCase(),
        sourceUrl: `https://boards.example/${tag}/${encodeURIComponent(title)}`,
        dedupeKey: `${tag}-${title}`,
        status: 'MATCHED',
        validationStatus: 'VALID',
        experienceLevel: 'FRESHER',
        experienceMinYears: '0',
        employmentType: 'FULL_TIME',
        locationCity: 'Bengaluru',
        locationCountry: 'India',
        firstSeenAt: IN_WEEK,
        ...over,
      })
      .returning({ id: jobs.id });
    await db.insert(jobMatches).values({
      jobId: row!.id,
      userId,
      profileVersion: 1,
      overallScore: score,
      skillScore: score,
      roleScore: score,
      experienceScore: 100,
      locationScore: 100,
      priority: score >= 90 ? 'VERY_HIGH' : score >= 75 ? 'HIGH' : score >= 60 ? 'MEDIUM' : 'OTHER',
      matchedSkills: ['Java'],
      missingSkills: ['SQL'],
      explanation: `Match ${score}%`,
    });
    return row!.id;
  };

  const weeklyRows = (id: string) =>
    db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, id), eq(notifications.type, 'WEEKLY')));

  beforeAll(async () => {
    telegram = new FakeTelegram();
    moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(HTTP_CLIENT)
      .useValue(new FakeHttpClient({}))
      .overrideProvider(TelegramClient)
      .useValue(telegram)
      .compile();
    db = moduleRef.get(DB);
    svc = moduleRef.get(WeeklySummaryService);
    admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    userId = await createUser('in', true);
    optedOutId = await createUser('out', false);
    const [c] = await db
      .insert(companies)
      .values({ name: `${tag} Co & <Sons>`, normalizedName: normalizeCompanyName(`${tag} Co`) })
      .returning({ id: companies.id });
    companyId = c!.id;

    const top = await seedJob('Graduate Engineer Trainee', 92);
    await seedJob('Associate SDE', 80);
    await seedJob('Trainee Analyst', 65);
    // Not counted: held, last week, closed, experienced.
    await seedJob('Held Trainee', 95, { status: 'NEEDS_REVIEW', holdReason: 'experience unknown' });
    await seedJob('Last Week Trainee', 95, { firstSeenAt: at(-9 * DAY) });
    await seedJob('Closed Trainee', 95, { closedAt: at(-2 * DAY) });
    await seedJob('Senior Engineer', 99, {
      experienceLevel: 'EXPERIENCED',
      experienceMinYears: '5',
    });

    await db.insert(applications).values({
      userId,
      jobId: top,
      status: 'INTERVIEW',
      appliedAt: at(-4 * DAY),
      history: [
        { status: 'VIEWED', at: at(-5 * DAY).toISOString() },
        { status: 'APPLIED', at: at(-4 * DAY).toISOString() },
        { status: 'INTERVIEW', at: at(-2 * DAY).toISOString() },
      ],
      interviewAt: at(3 * DAY),
    });
    await db.insert(reminders).values({
      userId,
      jobId: top,
      kind: 'INTERVIEW_DAY_BEFORE',
      anchor: at(3 * DAY).toISOString(),
      idempotencyKey: `${tag}-r1`,
      dueAt: at(2 * DAY),
    });
    const [s] = await db
      .insert(jobSources)
      .values({
        name: `${tag} paused board`,
        type: 'ATS_API',
        adapter: 'greenhouse',
        status: 'PAUSED_AUTO',
      })
      .returning({ id: jobSources.id });
    sourceId = s!.id;
  }, 180_000);

  afterAll(async () => {
    for (const id of [userId, optedOutId].filter(Boolean)) {
      await db.delete(notifications).where(eq(notifications.userId, id));
      await db.delete(reminders).where(eq(reminders.userId, id));
      await db.delete(applications).where(eq(applications.userId, id));
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
    for (const id of [userId, optedOutId].filter(Boolean)) {
      await db.delete(users).where(eq(users.id, id));
      await admin.auth.admin.deleteUser(id);
    }
    await moduleRef.close();
  }, 180_000);

  it('is not due before Sunday 09:00 IST, nor on a Wednesday', async () => {
    const early = await svc.sendDue({ now: at(-60_000), userIds: [userId] });
    const midweek = await svc.sendDue({ now: at(3 * DAY), userIds: [userId] });
    expect(early.queued + midweek.queued).toBe(0);
    expect(await weeklyRows(userId)).toHaveLength(0);
  });

  it('sends once per week: the scheduler runs twice, one web and one Telegram message', async () => {
    const first = await svc.sendDue({ now: SUNDAY_0930_IST, userIds: [userId, optedOutId] });
    const second = await svc.sendDue({
      now: new Date(SUNDAY_0930_IST.getTime() + 3_600_000),
      userIds: [userId, optedOutId],
    });
    expect(first.queued).toBe(1);
    expect(second.queued).toBe(0);
    const rows = await weeklyRows(userId);
    expect(rows.map((r) => r.channel).sort()).toEqual(['TELEGRAM', 'WEB']);
    expect(rows.every((r) => r.digestDate === WINDOW.weekKey)).toBe(true);
  });

  it('respects opt-in: nothing for a user who did not turn it on', async () => {
    expect(await weeklyRows(optedOutId)).toHaveLength(0);
  });

  it('has the right counts for the seeded week', async () => {
    const [web] = (await weeklyRows(userId)).filter((r) => r.channel === 'WEB');
    const p = web!.payload as {
      newJobs: { total: number; byPriority: Record<string, number> };
      applications: { applied: number; statusChanges: Record<string, number> };
      upcoming: { total: number; items: string[] };
      skillGaps: { skill: string; missingIn: number; of: number }[];
      sources: { paused: string[] };
    };
    // 3 valid, listed, open, fresher jobs this week; held/last-week/closed/experienced excluded.
    expect(p.newJobs).toEqual({
      total: 3,
      byPriority: { VERY_HIGH: 1, HIGH: 1, MEDIUM: 1, OTHER: 0 },
    });
    expect(p.applications.applied).toBe(1);
    expect(p.applications.statusChanges).toEqual({ APPLIED: 1, INTERVIEW: 1 });
    expect(p.upcoming.total).toBe(1);
    expect(p.upcoming.items[0]).toContain('Interview tomorrow: Graduate Engineer Trainee');
    expect(p.skillGaps[0]).toMatchObject({ skill: 'SQL' });
    expect(p.sources.paused).toContain(`${tag} paused board`);
  });

  it('reaches Telegram through the existing dispatcher, with employer text escaped', async () => {
    await moduleRef.get(DispatcherService).dispatchPending({ batch: 200 });
    const text = telegram.sent.find((m) => m.text.includes('JobSentinel Weekly'))?.text ?? '';
    expect(text).toContain('New valid jobs: 3');
    expect(text).toContain('Co &amp; &lt;Sons&gt;');
    expect(text).not.toContain('<Sons>');
  });
});
