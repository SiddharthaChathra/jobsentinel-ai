import './helpers/test-env';
import { Test } from '@nestjs/testing';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { and, eq, inArray } from 'drizzle-orm';
import { normalizeCompanyName } from '@jobsentinel/validation';
import { DB, type Db } from '../src/common/db/db.module';
import {
  applications,
  companies,
  jobs,
  notificationSettings,
  notifications,
  preferences,
  reminders,
  savedJobs,
  telegramLinks,
  users,
} from '../src/common/db/schema';
import { HTTP_CLIENT } from '../src/common/http/http.module';
import { TrackerService } from '../src/jobs/tracker.service';
import { DispatcherService } from '../src/notifications/dispatcher.service';
import { RemindersService } from '../src/notifications/reminders.service';
import { TelegramClient } from '../src/notifications/telegram.client';
import { WorkerModule } from '../src/worker.module';
import { FakeHttpClient } from './helpers/fake-http';

/**
 * Tracker reminders (F5, D119) against the local stack, with Telegram faked: each rule, no
 * duplicate across repeated runs, quiet hours defer rather than drop, status changes cancel,
 * snooze and dismiss. Every service call is scoped to this suite's user.
 */
const hasDb = Boolean(process.env.DATABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const describeIf = hasDb ? describe : describe.skip;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// 11:30 IST — outside every quiet window. 22:30 IST is 17:00 UTC; 07:00 IST is 01:30 UTC.
const DAYTIME = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 6, 0));

class FakeTelegram {
  sent: { chatId: string; text: string }[] = [];
  configured = true;
  botUsername = 'testbot';
  linkUrl(code: string) {
    return `https://t.me/testbot?start=${code}`;
  }
  sendMessage(input: { chatId: bigint | string; text: string }) {
    this.sent.push({ chatId: String(input.chatId), text: input.text });
    return Promise.resolve({ messageId: this.sent.length });
  }
  answerCallbackQuery() {
    return Promise.resolve();
  }
}

describeIf('tracker reminders (F5, D119)', () => {
  const tag = `remind-${Date.now()}`;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let db: Db;
  let svc: RemindersService;
  let tracker: TrackerService;
  let telegram: FakeTelegram;
  let admin: SupabaseClient;
  let userId: string;
  let companyId: string;

  const seedJob = async (title: string, over: Partial<typeof jobs.$inferInsert> = {}) => {
    const [row] = await db
      .insert(jobs)
      .values({
        companyId,
        title,
        normalizedTitle: title.toLowerCase(),
        sourceUrl: `https://boards.example/${tag}/${encodeURIComponent(title)}`,
        dedupeKey: `${tag}-${title}`,
        status: 'VALID',
        validationStatus: 'VALID',
        experienceLevel: 'FRESHER',
        ...over,
      })
      .returning({ id: jobs.id });
    return row!.id;
  };
  const remindersOf = (jobId: string) =>
    db
      .select()
      .from(reminders)
      .where(and(eq(reminders.userId, userId), eq(reminders.jobId, jobId)));
  const reminderNotifications = async (reminderId: string) =>
    (
      await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.userId, userId), eq(notifications.type, 'REMINDER')))
    ).filter((n) => (n.payload as { reminderId?: string }).reminderId === reminderId);
  const run = async (now: Date) => {
    const plan = await svc.plan({ now, userIds: [userId] });
    const deliver = await svc.deliver({ now, userIds: [userId] });
    return { plan, deliver };
  };

  beforeAll(async () => {
    telegram = new FakeTelegram();
    moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(HTTP_CLIENT)
      .useValue(new FakeHttpClient({}))
      .overrideProvider(TelegramClient)
      .useValue(telegram)
      .compile();
    db = moduleRef.get(DB);
    svc = moduleRef.get(RemindersService);
    tracker = moduleRef.get(TrackerService, { strict: false });
    admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const created = await admin.auth.admin.createUser({
      email: `${tag}@jobsentinel.test`,
      password: `R-${Math.random().toString(36).slice(2)}-Pass1!`,
      email_confirm: true,
    });
    if (created.error) throw new Error(created.error.message);
    userId = created.data.user!.id;
    await db
      .insert(users)
      .values({ id: userId, email: `${tag}@jobsentinel.test`, profileVersion: 1 });
    await db.insert(preferences).values({ userId, timezone: 'Asia/Kolkata' });
    await db.insert(notificationSettings).values({ userId, mode: 'BOTH', telegramEnabled: true });
    await db
      .insert(telegramLinks)
      .values({ userId, chatId: BigInt(998000000 + (Date.now() % 100000)), linkedAt: new Date() });
    const [c] = await db
      .insert(companies)
      .values({ name: `${tag} Co`, normalizedName: normalizeCompanyName(`${tag} Co`) })
      .returning({ id: companies.id });
    companyId = c!.id;
  }, 180_000);

  afterAll(async () => {
    if (userId) {
      await db.delete(notifications).where(eq(notifications.userId, userId));
      await db.delete(reminders).where(eq(reminders.userId, userId));
      await db.delete(applications).where(eq(applications.userId, userId));
      await db.delete(savedJobs).where(eq(savedJobs.userId, userId));
    }
    if (companyId) {
      await db.delete(jobs).where(eq(jobs.companyId, companyId));
      await db.delete(companies).where(inArray(companies.id, [companyId]));
    }
    if (userId) {
      await db.delete(users).where(eq(users.id, userId));
      await admin.auth.admin.deleteUser(userId);
    }
    await moduleRef.close();
  }, 180_000);

  it('follow-up: one reminder 7 days after applying, sent once however often the worker runs', async () => {
    const jobId = await seedJob('Graduate Engineer Trainee');
    const now = DAYTIME(new Date());
    await db.insert(applications).values({
      userId,
      jobId,
      status: 'APPLIED',
      appliedAt: new Date(now.getTime() - 8 * DAY),
      lastStatusChangeAt: new Date(now.getTime() - 8 * DAY),
    });

    const first = await run(now);
    expect(first.plan.created).toBe(1);
    expect(first.deliver.sent).toBe(1);
    const [r] = await remindersOf(jobId);
    expect(r).toMatchObject({ kind: 'FOLLOW_UP', status: 'SENT', deliveries: 1 });
    const queued = await reminderNotifications(r!.id);
    expect(queued.map((n) => n.channel).sort()).toEqual(['TELEGRAM', 'WEB']);

    // The worker runs again (and again): nothing new is planned or sent.
    for (let i = 0; i < 3; i++) {
      const again = await run(new Date(now.getTime() + i * HOUR));
      expect(again.plan.created).toBe(0);
      expect(again.deliver.sent).toBe(0);
    }
    expect(await reminderNotifications(r!.id)).toHaveLength(2);

    // The existing dispatcher delivers it to Telegram, escaped and labelled.
    await moduleRef.get(DispatcherService).dispatchPending({ batch: 200 });
    const text = telegram.sent.find((m) => m.text.includes('Graduate Engineer Trainee'))?.text;
    expect(text).toContain('Time to follow up');
    expect(text).toContain('no update for 8 days since you applied');
  });

  it('uses the follow-up days setting (3-14)', async () => {
    await db
      .update(notificationSettings)
      .set({ followUpDays: 3 })
      .where(eq(notificationSettings.userId, userId));
    const jobId = await seedJob('Associate Software Engineer');
    const now = DAYTIME(new Date());
    const changed = new Date(now.getTime() - DAY);
    await db
      .insert(applications)
      .values({ userId, jobId, status: 'APPLIED', lastStatusChangeAt: changed });
    await svc.plan({ now, userIds: [userId] });
    const [r] = await remindersOf(jobId);
    expect(r!.dueAt.getTime()).toBe(changed.getTime() + 3 * DAY);
    await db
      .update(notificationSettings)
      .set({ followUpDays: 7 })
      .where(eq(notificationSettings.userId, userId));
  });

  it('interview: the day before and the morning of, from the date picker', async () => {
    const jobId = await seedJob('Trainee Network Engineer');
    // Two days ahead at 10:00 IST (04:30 UTC).
    const base = new Date(Date.now() + 2 * DAY);
    const interviewAt = new Date(
      Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 4, 30),
    );
    await tracker.upsert(userId, jobId, { status: 'INTERVIEW' });
    await tracker.setDates(userId, jobId, { interviewAt: interviewAt.toISOString() });
    await svc.plan({ userIds: [userId] });
    const rows = (await remindersOf(jobId)).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
    expect(rows.map((r) => [r.kind, r.dueAt.toISOString()])).toEqual([
      ['INTERVIEW_DAY_BEFORE', new Date(interviewAt.getTime() - DAY).toISOString()],
      ['INTERVIEW_MORNING', new Date(interviewAt.getTime() - 2 * HOUR).toISOString()], // 08:00 IST
    ]);

    // Moving the interview cancels both and plans two new ones.
    await tracker.setDates(userId, jobId, {
      interviewAt: new Date(interviewAt.getTime() + DAY).toISOString(),
    });
    const moved = await svc.plan({ userIds: [userId] });
    expect(moved.cancelled).toBe(2);
    expect(moved.created).toBe(2);
  });

  it('quiet hours (22:00-07:00 IST) defer a due reminder to the morning, never drop it', async () => {
    const jobId = await seedJob('Graduate Trainee - Cloud');
    const night = new Date(Date.UTC(2026, 9, 19, 17, 0)); // 22:30 IST
    await db.insert(applications).values({
      userId,
      jobId,
      status: 'APPLIED',
      lastStatusChangeAt: new Date(night.getTime() - 7 * DAY - HOUR), // due 21:30 IST
    });
    const atNight = await run(night);
    expect(atNight.deliver.deferred).toBeGreaterThanOrEqual(1);
    const [waiting] = await remindersOf(jobId);
    expect(waiting!.status).toBe('PENDING');
    expect(await reminderNotifications(waiting!.id)).toHaveLength(0);

    const beforeSeven = await run(new Date(Date.UTC(2026, 9, 20, 1, 0))); // 06:30 IST
    expect((await remindersOf(jobId))[0]!.status).toBe('PENDING');
    expect(beforeSeven.deliver.sent).toBe(0);

    await run(new Date(Date.UTC(2026, 9, 20, 1, 30))); // 07:00 IST
    const [sent] = await remindersOf(jobId);
    expect(sent!.status).toBe('SENT');
    expect(await reminderNotifications(sent!.id)).toHaveLength(2);
  });

  it('deadline: saved and not applied gets 3-day and 1-day reminders; applying cancels them; REJECTED cancels the follow-up', async () => {
    const deadline = new Date(Date.now() + 10 * DAY);
    const jobId = await seedJob('Graduate Engineer - Campus 2027', { deadline });
    await db.insert(savedJobs).values({ userId, jobId });
    await svc.plan({ userIds: [userId] });
    expect((await remindersOf(jobId)).map((r) => r.kind).sort()).toEqual([
      'DEADLINE_1D',
      'DEADLINE_3D',
    ]);

    await tracker.upsert(userId, jobId, { status: 'APPLIED' });
    const afterApply = await svc.plan({ userIds: [userId] });
    expect(afterApply.cancelled).toBe(2);
    const rows = await remindersOf(jobId);
    expect(rows.filter((r) => r.status === 'PENDING').map((r) => r.kind)).toEqual(['FOLLOW_UP']);

    await tracker.upsert(userId, jobId, { status: 'REJECTED' });
    await svc.plan({ userIds: [userId] });
    expect((await remindersOf(jobId)).filter((r) => r.status === 'PENDING')).toHaveLength(0);
  });

  it('the follow-up clock restarts only on a real status change, not a repeat of the same status', async () => {
    const jobId = await seedJob('Junior Data Analyst Trainee');
    await tracker.upsert(userId, jobId, { status: 'APPLIED' });
    const [first] = await db
      .select()
      .from(applications)
      .where(and(eq(applications.userId, userId), eq(applications.jobId, jobId)));
    await new Promise((r) => setTimeout(r, 20));
    await tracker.upsert(userId, jobId, { status: 'APPLIED', notes: 'emailed HR' });
    const [repeat] = await db
      .select()
      .from(applications)
      .where(and(eq(applications.userId, userId), eq(applications.jobId, jobId)));
    expect(repeat!.lastStatusChangeAt!.getTime()).toBe(first!.lastStatusChangeAt!.getTime());
    await tracker.upsert(userId, jobId, { status: 'INTERVIEW' });
    const [moved] = await db
      .select()
      .from(applications)
      .where(and(eq(applications.userId, userId), eq(applications.jobId, jobId)));
    expect(moved!.lastStatusChangeAt!.getTime()).toBeGreaterThan(
      first!.lastStatusChangeAt!.getTime(),
    );
  });

  it('snooze re-delivers later (as a new delivery); dismiss removes it from the list', async () => {
    const jobId = await seedJob('Software Engineer Trainee');
    const now = DAYTIME(new Date());
    await db.insert(applications).values({
      userId,
      jobId,
      status: 'APPLIED',
      lastStatusChangeAt: new Date(now.getTime() - 9 * DAY),
    });
    await run(now);
    const [r] = await remindersOf(jobId);
    expect(r!.status).toBe('SENT');
    expect((await svc.list(userId)).find((x) => x.id === r!.id)?.state).toBe('DUE');

    const snoozed = await svc.snooze(userId, r!.id, 1);
    expect(snoozed.status).toBe('PENDING');
    expect(snoozed.state).toBe('UPCOMING');
    // Snooze uses the real clock; pin it to this test's daytime clock so the re-delivery is
    // never in quiet hours, whatever time the suite runs.
    await db
      .update(reminders)
      .set({ snoozedUntil: new Date(now.getTime() + HOUR) })
      .where(eq(reminders.id, r!.id));
    await run(new Date(now.getTime() + 2 * HOUR));
    const [again] = await remindersOf(jobId);
    expect(again).toMatchObject({ status: 'SENT', deliveries: 2 });
    expect((await reminderNotifications(r!.id)).filter((n) => n.channel === 'WEB')).toHaveLength(2);

    await svc.dismiss(userId, r!.id);
    expect((await svc.list(userId)).find((x) => x.id === r!.id)).toBeUndefined();
    // Dismissed stays dismissed: re-planning never brings it back.
    await run(new Date(now.getTime() + 3 * HOUR));
    expect((await remindersOf(jobId))[0]!.status).toBe('DISMISSED');
  });

  it("another user's reminder cannot be snoozed or dismissed", async () => {
    const [r] = await db.select().from(reminders).where(eq(reminders.userId, userId)).limit(1);
    const stranger = '00000000-0000-4000-8000-00000000beef';
    await expect(svc.snooze(stranger, r!.id, 1)).rejects.toMatchObject({
      code: 'REMINDER_NOT_FOUND',
    });
    await expect(svc.dismiss(stranger, r!.id)).rejects.toMatchObject({
      code: 'REMINDER_NOT_FOUND',
    });
  });

  it('turning reminders off cancels due ones instead of sending them', async () => {
    const jobId = await seedJob('Graduate Analyst');
    const now = DAYTIME(new Date());
    await db.insert(applications).values({
      userId,
      jobId,
      status: 'APPLIED',
      lastStatusChangeAt: new Date(now.getTime() - 10 * DAY),
    });
    await svc.plan({ now, userIds: [userId] });
    await db
      .update(notificationSettings)
      .set({ remindersEnabled: false })
      .where(eq(notificationSettings.userId, userId));
    const result = await svc.deliver({ now, userIds: [userId] });
    expect(result.sent).toBe(0);
    expect((await remindersOf(jobId))[0]!.status).toBe('CANCELLED');
    await db
      .update(notificationSettings)
      .set({ remindersEnabled: true })
      .where(eq(notificationSettings.userId, userId));
  });
});
