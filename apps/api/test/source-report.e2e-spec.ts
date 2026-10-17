import './helpers/test-env';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { SourceReport } from '@jobsentinel/types';
import { normalizeCompanyName } from '@jobsentinel/validation';
import { AppModule } from '../src/app.module';
import { DB, type Db } from '../src/common/db/db.module';
import {
  companies,
  jobEvents,
  jobs,
  jobSourceMappings,
  jobSources,
  notifications,
  users,
} from '../src/common/db/schema';
import { HTTP_CLIENT } from '../src/common/http/http.module';
import { SchedulerService } from '../src/scheduler/scheduler.service';
import { WorkerLoop } from '../src/scheduler/worker-loop';
import { SourceReportService } from '../src/sources/source-report.service';
import { FakeHttpClient } from './helpers/fake-http';

/**
 * Source report card and auto-pause (F2, D103), against the local test database. Five sources,
 * one per case: kept-zero (paused), errors, collected-nothing, too young, and keeps jobs.
 */
const hasDb = Boolean(process.env.DATABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const describeIf = hasDb ? describe : describe.skip;

describeIf('source report card and auto-pause (F2)', () => {
  const tag = `srcrep-${Date.now()}`;
  let app: INestApplication;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let db: Db;
  let supa: SupabaseClient;
  let adminToken: string;
  let userToken: string;
  const userIds: string[] = [];
  let companyId: string;
  const src: Record<'keptZero' | 'errors' | 'nothing' | 'young' | 'keeps', string> = {
    keptZero: '',
    errors: '',
    nothing: '',
    young: '',
    keeps: '',
  };
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
  const api = () => request(app.getHttpServer() as Parameters<typeof request>[0]);

  const signUp = async (name: string, isAdmin: boolean) => {
    const email = `${tag}-${name}@jobsentinel.test`;
    const password = `S-${Math.random().toString(36).slice(2)}-Pass1!`;
    const created = await supa.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw new Error(created.error.message);
    const id = created.data.user!.id;
    userIds.push(id);
    await db.insert(users).values({ id, email, isAdmin });
    const signIn = await createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
    ).auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(signIn.error.message);
    return signIn.data.session!.access_token;
  };

  const seedSource = async (name: string, over: Partial<typeof jobSources.$inferInsert> = {}) => {
    const [row] = await db
      .insert(jobSources)
      .values({
        name: `${tag} ${name}`,
        type: 'ATS_API',
        adapter: 'greenhouse',
        config: { board: `${tag}-${name}` },
        createdAt: daysAgo(90),
        ...over,
      })
      .returning({ id: jobSources.id });
    return row!.id;
  };

  /** A job collected by `sourceId` 10 days ago: filtered with `reason`, or listed when null. */
  const collect = async (sourceId: string, title: string, reason: string | null) => {
    const [job] = await db
      .insert(jobs)
      .values({
        companyId,
        title,
        normalizedTitle: title.toLowerCase(),
        roleFamily: 'software_engineer',
        category: 'SOFTWARE',
        description: `${title}.`,
        experienceLevel: 'FRESHER',
        experienceMinYears: '0',
        fresherEligible: true,
        locationCountry: 'India',
        sourceUrl: `https://boards.example/${tag}/${encodeURIComponent(title)}`,
        applicationUrl: `https://boards.example/${tag}/${encodeURIComponent(title)}/apply`,
        dedupeKey: `${tag}-${title}`,
        status: reason ? 'FILTERED_OUT' : 'VALID',
        validationStatus: reason ? 'PENDING' : 'VALID',
        firstSeenAt: daysAgo(10),
      })
      .returning({ id: jobs.id });
    await db.insert(jobSourceMappings).values({
      jobId: job!.id,
      sourceId,
      externalId: `${tag}-${title}`,
      sourceUrl: `https://boards.example/${tag}/${encodeURIComponent(title)}`,
      firstSeenAt: daysAgo(10),
    });
    if (reason)
      await db
        .insert(jobEvents)
        .values({ jobId: job!.id, type: 'FILTERED_OUT', detail: { reason } });
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(HTTP_CLIENT)
      .useValue(new FakeHttpClient({}))
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });
    await app.init();
    db = moduleRef.get(DB);
    supa = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    adminToken = await signUp('admin', true);
    userToken = await signUp('user', false);

    const [c] = await db
      .insert(companies)
      .values({ name: `${tag} Co`, normalizedName: normalizeCompanyName(`${tag} Co`) })
      .returning({ id: companies.id });
    companyId = c!.id;

    src.keptZero = await seedSource('kept-zero');
    src.errors = await seedSource('errors', { status: 'FAILING', consecutiveFailures: 4 });
    src.nothing = await seedSource('collected-nothing');
    src.young = await seedSource('young', { createdAt: daysAgo(10) });
    src.keeps = await seedSource('keeps');
    for (const key of ['keptZero', 'errors', 'young'] as const) {
      await collect(src[key], `${key} sales role`, 'category not monitored');
      await collect(src[key], `${key} senior role`, 'asks for 3+ years');
      await collect(src[key], `${key} us role`, 'location outside India (United States)');
    }
    await collect(src.keeps, 'keeps sales role', 'category not monitored');
    await collect(src.keeps, 'keeps graduate engineer', null);
  }, 180_000);

  afterAll(async () => {
    const ids = Object.values(src).filter(Boolean);
    if (companyId) {
      await db.delete(jobs).where(eq(jobs.companyId, companyId));
      await db.delete(companies).where(eq(companies.id, companyId));
    }
    if (ids.length) await db.delete(jobSources).where(inArray(jobSources.id, ids));
    if (userIds.length) {
      await db.delete(notifications).where(inArray(notifications.userId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
      for (const id of userIds) await supa.auth.admin.deleteUser(id);
    }
    // leaseDueSources below leases seeded sources too; give them back.
    await db.update(jobSources).set({ leaseUntil: null });
    await app.close();
  }, 180_000);

  it('reports collected vs kept per source, with rejections by reason and the health case', async () => {
    const res = await api()
      .get('/api/v1/sources/report?days=30')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const report = (res.body as { data: SourceReport }).data;
    const row = (id: string) => report.sources.find((s) => s.id === id)!;

    expect(row(src.keptZero)).toMatchObject({
      collected: 3,
      kept: 0,
      health: 'KEPT_ZERO',
      lastKeptAt: null,
    });
    expect(row(src.keptZero).rejected).toMatchObject({ CATEGORY: 1, EXPERIENCE: 1, LOCATION: 1 });
    expect(row(src.errors)).toMatchObject({ collected: 3, kept: 0, health: 'ERRORS' });
    expect(row(src.nothing)).toMatchObject({ collected: 0, kept: 0, health: 'COLLECTED_NOTHING' });
    expect(row(src.keeps)).toMatchObject({ collected: 2, kept: 1, health: 'OK' });
    expect(row(src.keeps).lastKeptAt).not.toBeNull();
    // Manual recount of what was seeded for these five sources.
    const mine = report.sources.filter((s) => Object.values(src).includes(s.id));
    expect(mine.reduce((n, s) => n + s.collected, 0)).toBe(11);
    expect(mine.reduce((n, s) => n + s.kept, 0)).toBe(1);
  });

  it('validates the window and is admin-only', async () => {
    await api()
      .get('/api/v1/sources/report?days=5')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
    await api()
      .get('/api/v1/sources/report?days=7')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('auto-pauses only the kept-zero source, once, and tells the admin once', async () => {
    const loop = moduleRef.get(WorkerLoop) as unknown as {
      pauseIdleSources(): Promise<{ paused: number }>;
    };
    const service = moduleRef.get(SourceReportService);
    const first = await service.autoPause(new Date(), Object.values(src));
    expect(first.map((p) => p.id)).toEqual([src.keptZero]);
    expect(first[0]!.reason).toMatch(/kept none/);
    // The worker path: nothing left to pause, so no second notice.
    await loop.pauseIdleSources();
    expect(await service.autoPause(new Date(), Object.values(src))).toEqual([]);

    const statuses = await db
      .select({ id: jobSources.id, status: jobSources.status })
      .from(jobSources)
      .where(inArray(jobSources.id, Object.values(src)));
    const status = new Map(statuses.map((s) => [s.id, s.status]));
    expect(status.get(src.keptZero)).toBe('PAUSED_AUTO');
    expect(status.get(src.errors)).toBe('FAILING');
    expect(status.get(src.nothing)).toBe('ACTIVE');
    expect(status.get(src.young)).toBe('ACTIVE');
    expect(status.get(src.keeps)).toBe('ACTIVE');
  });

  it('sends the pause notice once even when the worker runs again', async () => {
    // Pause via the worker path for a fresh case: resume, back-date the resume, run the worker twice.
    await db
      .update(jobSources)
      .set({ status: 'ACTIVE', resumedAt: daysAgo(31), pausedAt: null, pausedReason: null })
      .where(eq(jobSources.id, src.keptZero));
    const loop = moduleRef.get(WorkerLoop) as unknown as {
      pauseIdleSources(): Promise<{ paused: number }>;
    };
    await loop.pauseIdleSources();
    await loop.pauseIdleSources();
    const adminId = userIds[0]!;
    const notices = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, adminId),
          eq(notifications.type, 'SYSTEM'),
          eq(notifications.channel, 'WEB'),
          sql`${notifications.payload}->>'key' = ${`source-paused:${src.keptZero}`}`,
        ),
      );
    expect(notices).toHaveLength(1);
  });

  it('never schedules a paused source for scanning', async () => {
    const leased = await moduleRef.get(SchedulerService).leaseDueSources(1000);
    const ids = leased.map((s) => s.id);
    expect(ids).not.toContain(src.keptZero);
    expect(ids).toContain(src.keeps);
  });

  it('resumes with one call, and refuses to resume a source that is not paused', async () => {
    const res = await api()
      .post(`/api/v1/sources/${src.keptZero}/resume`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect((res.body as { data: { status: string } }).data.status).toBe('ACTIVE');
    const [row] = await db
      .select({ resumedAt: jobSources.resumedAt, pausedReason: jobSources.pausedReason })
      .from(jobSources)
      .where(eq(jobSources.id, src.keptZero));
    expect(row!.resumedAt).not.toBeNull();
    expect(row!.pausedReason).toBeNull();
    // Resumed today: inside the 30-day grace, so not paused again straight away.
    expect(await moduleRef.get(SourceReportService).autoPause(new Date(), [src.keptZero])).toEqual(
      [],
    );

    await api()
      .post(`/api/v1/sources/${src.keptZero}/resume`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
    await api()
      .post(`/api/v1/sources/${src.keeps}/resume`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });
});
