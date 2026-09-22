import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { and, eq, inArray } from 'drizzle-orm';
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
import { DigestService } from '../src/notifications/digest.service';
import { DispatcherService } from '../src/notifications/dispatcher.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { TelegramClient } from '../src/notifications/telegram.client';
import { WorkerModule } from '../src/worker.module';
import { FakeHttpClient } from './helpers/fake-http';

/**
 * The two promises of the notification layer (docs 10 §2, §5), against the live database:
 * never notify twice for the same job, and never lose an alert because delivery failed.
 * Telegram itself is faked — the client is covered by unit tests and a live run.
 */
const hasDb = Boolean(process.env.DATABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const describeIf = hasDb ? describe : describe.skip;

class FakeTelegram {
  sent: { chatId: string; text: string; buttons?: unknown }[] = [];
  failWith: Error | null = null;
  configured = true;
  botUsername = 'testbot';
  linkUrl(code: string) {
    return `https://t.me/testbot?start=${code}`;
  }
  sendMessage(input: { chatId: bigint | string; text: string; buttons?: unknown }) {
    if (this.failWith) return Promise.reject(this.failWith);
    this.sent.push({ chatId: String(input.chatId), text: input.text, buttons: input.buttons });
    return Promise.resolve({ messageId: this.sent.length });
  }
  answerCallbackQuery() {
    return Promise.resolve();
  }
}

describeIf('notifications (integration)', () => {
  const tag = `notif-${Date.now()}`;
  let db: Db;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let service: NotificationsService;
  let dispatcher: DispatcherService;
  let digest: DigestService;
  let telegram: FakeTelegram;
  let admin: SupabaseClient;
  let userId: string;
  let companyId: string;
  let goodJobId: string;

  const seedJob = async (title: string, over: Partial<typeof jobs.$inferInsert> = {}) => {
    const [row] = await db
      .insert(jobs)
      .values({
        companyId,
        title,
        normalizedTitle: title.toLowerCase(),
        roleFamily: 'software_engineer',
        category: 'SOFTWARE',
        description: 'Build services.',
        skills: ['Python'],
        experienceLevel: 'FRESHER',
        fresherEligible: true,
        locationCity: 'Bengaluru',
        locationCountry: 'India',
        sourceUrl: `https://boards.example/${tag}/${encodeURIComponent(title)}`,
        applicationUrl: `https://boards.example/${tag}/${encodeURIComponent(title)}/apply`,
        dedupeKey: `${tag}-${title}`,
        status: 'MATCHED',
        validationStatus: 'VALID',
        firstSeenAt: new Date(),
        ...over,
      })
      .returning({ id: jobs.id });
    return row!.id;
  };

  const seedMatch = async (jobId: string, score: number) => {
    await db.insert(jobMatches).values({
      jobId,
      userId,
      profileVersion: 1,
      overallScore: score,
      skillScore: score,
      roleScore: score,
      experienceScore: 100,
      locationScore: 100,
      priority: score >= 90 ? 'VERY_HIGH' : score >= 75 ? 'HIGH' : 'MEDIUM',
      matchedSkills: ['Python'],
      missingSkills: [],
      explanation: `Match ${score}%`,
    });
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
    service = moduleRef.get(NotificationsService);
    dispatcher = moduleRef.get(DispatcherService);
    digest = moduleRef.get(DigestService);

    admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const created = await admin.auth.admin.createUser({
      email: `${tag}@jobsentinel.test`,
      password: `N-${Math.random().toString(36).slice(2)}-Pass1!`,
      email_confirm: true,
    });
    if (created.error) throw new Error(created.error.message);
    userId = created.data.user!.id;

    await db
      .insert(users)
      .values({ id: userId, email: `${tag}@jobsentinel.test`, profileVersion: 1 });
    await db.insert(preferences).values({ userId, timezone: 'Asia/Kolkata' });
    await db.insert(notificationSettings).values({
      userId,
      mode: 'BOTH',
      instantMinScore: 75,
      telegramEnabled: true,
    });
    await db
      .insert(telegramLinks)
      .values({ userId, chatId: BigInt(999000000 + (Date.now() % 100000)), linkedAt: new Date() });

    const [c] = await db
      .insert(companies)
      .values({
        name: `${tag} Co`,
        normalizedName: normalizeCompanyName(`${tag} Co`),
        verificationStatus: 'VERIFIED',
      })
      .returning({ id: companies.id });
    companyId = c!.id;

    goodJobId = await seedJob('Graduate Software Engineer');
    await seedMatch(goodJobId, 95);
  }, 180_000);

  afterAll(async () => {
    if (userId) await db.delete(notifications).where(eq(notifications.userId, userId));
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

  it('queues one web and one Telegram alert for a strong, fresh, verified match', async () => {
    const result = await service.enqueuePending({ userIds: [userId] });
    expect(result.instant).toBe(1);

    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.jobId, goodJobId)));
    expect(rows.map((r) => r.channel).sort()).toEqual(['TELEGRAM', 'WEB']);
    expect(rows.every((r) => r.status === 'PENDING')).toBe(true);
  }, 120_000);

  it('never queues a second alert for the same job, however often it runs', async () => {
    const before = await countFor(goodJobId);
    await service.enqueuePending({ userIds: [userId] });
    await service.enqueuePending({ userIds: [userId] });
    expect(await countFor(goodJobId)).toBe(before);
  }, 120_000);

  it('delivers to both channels and marks the job NOTIFIED', async () => {
    const result = await dispatcher.dispatchPending({ batch: 20 });
    expect(result.sent).toBeGreaterThanOrEqual(2);
    expect(telegram.sent.length).toBeGreaterThanOrEqual(1);
    expect(telegram.sent[0]!.text).toContain('Graduate Software Engineer');
    expect(telegram.sent[0]!.text).toContain('🛡 Company verified');

    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, goodJobId) });
    expect(job!.status).toBe('NOTIFIED');
    expect(job!.notifiedAt).not.toBeNull();

    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.jobId, goodJobId)));
    expect(rows.every((r) => r.status === 'SENT')).toBe(true);
  }, 120_000);

  it('keeps the web alert even when Telegram fails, and retries rather than dropping it', async () => {
    const jobId = await seedJob('Backend Engineer Trainee');
    await seedMatch(jobId, 92);
    await service.enqueuePending({ userIds: [userId] });

    telegram.failWith = new Error('telegram down');
    const result = await dispatcher.dispatchPending({ batch: 20 });
    telegram.failWith = null;

    expect(result.sent).toBeGreaterThanOrEqual(1); // the WEB row still went through
    expect(result.retrying).toBeGreaterThanOrEqual(1);

    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.jobId, jobId)));
    const web = rows.find((r) => r.channel === 'WEB')!;
    const tg = rows.find((r) => r.channel === 'TELEGRAM')!;
    expect(web.status).toBe('SENT');
    // Still queued with a future retry — an outage delays an alert, it never loses one.
    expect(tg.status).toBe('PENDING');
    expect(tg.sendAfter!.getTime()).toBeGreaterThan(Date.now());
    expect(tg.error).toContain('telegram down');
  }, 120_000);

  it('does not alert for a job the user is not eligible to be alerted about', async () => {
    const lowId = await seedJob('Senior Staff Engineer', {
      experienceLevel: 'EXPERIENCED',
      fresherEligible: false,
    });
    await seedMatch(lowId, 40); // below instantMinScore
    const unverifiedId = await seedJob('Unverified Role', { validationStatus: 'NEEDS_REVIEW' });
    await seedMatch(unverifiedId, 95);

    await service.enqueuePending({ userIds: [userId] });

    expect(await countFor(lowId)).toBe(0); // digest material, not an alert
    expect(await countFor(unverifiedId)).toBe(0); // unconfirmed jobs are never pushed
  }, 120_000);

  it('sends exactly one digest per local day', async () => {
    const first = await digest.sendDue({ userIds: [userId], force: true });
    expect(first.queued).toBe(1);
    const second = await digest.sendDue({ userIds: [userId], force: true });
    expect(second.queued).toBe(0); // the (user, channel, digest_date) index holds the line

    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.type, 'DIGEST')));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const payload = rows[0]!.payload as { counts?: Record<string, number> };
    expect(payload.counts).toBeDefined();
  }, 120_000);

  it('queues a test alert on every configured channel', async () => {
    const { channels } = await service.enqueueTest(userId);
    expect(channels.sort()).toEqual(['TELEGRAM', 'WEB']);
  }, 120_000);

  it('rate-limits repeated system alerts of the same kind', async () => {
    const first = await service.enqueueSystemAlert(
      userId,
      'source-down',
      'Source disabled',
      'greenhouse failed 3×',
    );
    const second = await service.enqueueSystemAlert(
      userId,
      'source-down',
      'Source disabled',
      'greenhouse failed 3×',
    );
    expect(first).toBe(true);
    expect(second).toBe(false); // one per type per 6 h
  }, 120_000);

  const countFor = async (jobId: string) => {
    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.jobId, jobId)));
    return rows.length;
  };
});
