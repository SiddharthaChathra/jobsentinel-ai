import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { and, eq, inArray } from 'drizzle-orm';
import type { AIRequest, AIResult, AIService } from '@jobsentinel/ai';
import { normalizeCompanyName } from '@jobsentinel/validation';
import { AI_SERVICE } from '../src/common/ai/ai.module';
import { DB, type Db } from '../src/common/db/db.module';
import { companies, jobEvents, jobs, preferences, savedJobs, users } from '../src/common/db/schema';
import { HTTP_CLIENT } from '../src/common/http/http.module';
import { ClassificationService } from '../src/jobs/classification.service';
import { WorkerModule } from '../src/worker.module';
import { FakeHttpClient } from './helpers/fake-http';

/**
 * Classification stage against the live DB (docs 09 §4): rules decide, preferences gate,
 * the AI is consulted only for ambiguous monitored jobs, and its failure is never fatal.
 */
const hasDb = Boolean(process.env.DATABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const describeIf = hasDb ? describe : describe.skip;

type Scripted = {
  data?: unknown;
  status?: 'INVALID_JSON' | 'ERROR' | 'BUDGET_EXCEEDED' | 'UNAVAILABLE';
};

class FakeAi {
  readonly calls: AIRequest<unknown>[] = [];
  constructor(private readonly script: Scripted = { status: 'ERROR' }) {}
  run<T>(req: AIRequest<T>): Promise<AIResult<T>> {
    this.calls.push(req as AIRequest<unknown>);
    if (this.script.data) {
      return Promise.resolve({
        status: 'OK',
        data: this.script.data as T,
        provider: 'fake',
        model: 'fake',
        usage: { inputTokens: 1, outputTokens: 1 },
        latencyMs: 1,
        cached: false,
      });
    }
    return Promise.resolve({ status: this.script.status ?? 'ERROR', error: 'scripted failure' });
  }
}

describeIf('classification stage (integration)', () => {
  const tag = `classify-${Date.now()}`;
  let db: Db;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let fakeAi: FakeAi;
  let service: ClassificationService;
  let companyId: string;
  let userId: string;
  let admin: SupabaseClient;

  const seedJob = async (
    title: string,
    description: string,
    extra: Partial<typeof jobs.$inferInsert> = {},
  ) => {
    const [row] = await db
      .insert(jobs)
      .values({
        companyId,
        title,
        normalizedTitle: title.toLowerCase(),
        description,
        sourceUrl: `https://boards.example/${tag}/${encodeURIComponent(title)}`,
        dedupeKey: `${tag}-${title}`,
        status: 'DISCOVERED',
        // dated in the past so the FIFO classification batch always picks the test's own jobs first
        firstSeenAt: new Date('2020-01-01T00:00:00Z'),
        // These cases exercise the fresher/category rules, not the location gate, so they need a
        // location the gate accepts. No real posting arrives with no location at all — measured
        // 0 of 3,394 — so leaving it unset was testing a state that does not occur (D73).
        locationCity: 'Bengaluru',
        locationCountry: 'India',
        locationText: 'Bengaluru, India',
        ...extra,
      })
      .returning({ id: jobs.id });
    return row!.id;
  };

  const build = async (script?: Scripted) => {
    fakeAi = new FakeAi(script);
    moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(HTTP_CLIENT)
      .useValue(new FakeHttpClient({}))
      .overrideProvider(AI_SERVICE)
      .useValue(fakeAi as unknown as AIService)
      .compile();
    db = moduleRef.get(DB);
    service = moduleRef.get(ClassificationService);
  };

  beforeAll(async () => {
    await build();
    const [c] = await db
      .insert(companies)
      .values({ name: `${tag} Co`, normalizedName: normalizeCompanyName(`${tag} Co`) })
      .returning();
    companyId = c!.id;
    // A real auth user (users.id has an FK to auth.users) who monitors software/support only.
    admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const created = await admin.auth.admin.createUser({
      email: `${tag}@jobsentinel.test`,
      password: `Cls-${Math.random().toString(36).slice(2)}-Pass1!`,
      email_confirm: true,
    });
    if (created.error) throw new Error(created.error.message);
    userId = created.data.user!.id;
    await db.insert(users).values({ id: userId, email: `${tag}@jobsentinel.test` });
    await db.insert(preferences).values({
      userId,
      categories: ['SOFTWARE', 'IT_SUPPORT'],
      fresherOnly: true,
      includeUnknownExperience: true,
    });
  }, 60_000);

  afterAll(async () => {
    await db.delete(jobs).where(eq(jobs.companyId, companyId));
    await db.delete(companies).where(eq(companies.id, companyId));
    await db.delete(users).where(eq(users.id, userId));
    if (userId) await admin.auth.admin.deleteUser(userId);
    // requeueFiltered() is intentionally global (a preferences change re-classifies everything),
    // so leave the shared project in a classified state again.
    for (;;) {
      const r = await service.classifyPending({ batch: 500 });
      if (r.processed === 0) break;
    }
    await moduleRef.close();
  }, 600_000);

  const statusOf = async (id: string) =>
    (await db.query.jobs.findFirst({ where: eq(jobs.id, id) }))!;

  it('classifies clear cases with rules alone and never calls the AI for them', async () => {
    const fresherId = await seedJob(
      'Graduate Engineer Trainee',
      'Join our GET programme. 0-1 years. B.E. 2027 batch.',
    );
    const seniorId = await seedJob(
      'Senior Software Engineer',
      'You have 8+ years of experience with distributed systems.',
    );
    const result = await service.classifyPending({ batch: 500, jobIds: [fresherId, seniorId] });

    expect(result.processed).toBeGreaterThanOrEqual(2);
    expect(fakeAi.calls).toHaveLength(0);

    const fresher = await statusOf(fresherId);
    expect(fresher).toMatchObject({
      status: 'CLASSIFIED',
      experienceLevel: 'FRESHER',
      fresherEligible: true,
      category: 'SOFTWARE',
    });
    expect(Number(fresher.fresherConfidence)).toBeGreaterThanOrEqual(0.8);
    expect((fresher.fresherEvidence as { code: string }[]).length).toBeGreaterThan(0);

    // fresher-only mode: an experienced role is filtered out, but the row and its evidence survive.
    const senior = await statusOf(seniorId);
    expect(senior).toMatchObject({
      status: 'FILTERED_OUT',
      experienceLevel: 'EXPERIENCED',
      fresherEligible: false,
    });
    const events = await db.select().from(jobEvents).where(eq(jobEvents.jobId, seniorId));
    expect(events.map((e) => e.type)).toContain('FILTERED_OUT');
  }, 60_000);

  it('filters out unmonitored categories without spending an AI call', async () => {
    const salesId = await seedJob(
      'Enterprise Account Executive',
      'Sell our platform to enterprises.',
    );
    // The category gate is the union of EVERY user's monitored categories, so this test cannot
    // make a category unmonitored by configuring its own user. It picks one that no account in
    // the project currently watches, and skips the case if every engineering category is watched.
    const monitored = new Set(
      (await db.select({ categories: preferences.categories }).from(preferences)).flatMap(
        (r) => r.categories,
      ),
    );
    const unmonitored = (['DATA', 'MECHANICAL', 'CIVIL', 'ELECTRICAL_ELECTRONICS'] as const).find(
      (c) => !monitored.has(c),
    );

    const dataId = unmonitored
      ? await seedJob(
          unmonitored === 'DATA' ? 'Data Analyst' : 'Site Engineer',
          unmonitored === 'DATA' ? 'Build dashboards.' : 'Supervise construction works on site.',
        )
      : null;

    await service.classifyPending({
      batch: 500,
      jobIds: [salesId, ...(dataId ? [dataId] : [])],
    });

    // A non-engineering posting is filtered whatever the preferences say.
    expect(await statusOf(salesId)).toMatchObject({
      status: 'FILTERED_OUT',
      category: 'NON_ENGINEERING',
    });
    if (dataId) {
      expect(await statusOf(dataId)).toMatchObject({ status: 'FILTERED_OUT' });
    }
    expect(fakeAi.calls).toHaveLength(0);
  }, 60_000);

  it('asks the AI only for ambiguous monitored jobs and applies a confident verdict', async () => {
    await moduleRef.close();
    await build({
      data: {
        level: 'FRESHER',
        fresherEligible: true,
        confidence: 0.82,
        evidence: ['"open to recent graduates"'],
      },
    });
    const id = await seedJob(
      'Software Engineer',
      'Join the platform team and help us build great products for our customers.',
    );
    await service.classifyPending({ batch: 500, maxAiCalls: 5, jobIds: [id] });

    expect(fakeAi.calls).toHaveLength(1);
    expect(fakeAi.calls[0]!.purpose).toBe('FRESHER_CLASSIFY');
    const job = await statusOf(id);
    expect(job).toMatchObject({
      status: 'CLASSIFIED',
      experienceLevel: 'FRESHER',
      fresherEligible: true,
    });
    expect(
      (job.fresherEvidence as { code: string; detail: string }[]).some((e) => e.code === 'AI'),
    ).toBe(true);
  }, 60_000);

  it('ignores a low-confidence AI verdict and keeps the rules result', async () => {
    await moduleRef.close();
    await build({
      data: { level: 'EXPERIENCED', fresherEligible: false, confidence: 0.3, evidence: ['guess'] },
    });
    const id = await seedJob(
      'Backend Engineer',
      'Work with our team on services and APIs for our growing platform.',
    );
    await service.classifyPending({ batch: 500, maxAiCalls: 5, jobIds: [id] });
    const job = await statusOf(id);
    expect(job.experienceLevel).toBe('UNKNOWN');
    expect(job.status).toBe('CLASSIFIED'); // unknown experience is still monitored, not hidden
  }, 60_000);

  it('survives an AI outage: the job is still classified by rules', async () => {
    await moduleRef.close();
    await build({ status: 'BUDGET_EXCEEDED' });
    const id = await seedJob(
      'Support Engineer',
      'Help customers with technical issues across our products every day.',
    );
    const result = await service.classifyPending({ batch: 500, maxAiCalls: 5, jobIds: [id] });
    expect(result.aiUnavailable).toBeGreaterThanOrEqual(1);
    const job = await statusOf(id);
    expect(job.status).toBe('CLASSIFIED');
    expect(job.experienceLevel).toBe('UNKNOWN');
  }, 60_000);

  it('keeps an India or country-less remote job and filters a foreign one (D73)', async () => {
    // Same proven fresher/SOFTWARE title and description for all four, so that location is the
    // only variable — a place name in the title steers the category classifier on its own.
    const desc = 'Join our GET programme. 0-1 years. B.E. 2027 batch. Java, SQL and REST APIs.';
    const indian = await seedJob('Graduate Software Engineer One', desc, {
      locationCity: null,
      locationCountry: 'India',
      locationText: 'Raipur, Chhattisgarh',
    });
    const remoteAnywhere = await seedJob('Graduate Software Engineer Two', desc, {
      isRemote: true,
      locationCity: null,
      locationCountry: null,
      locationText: 'Remote',
    });
    const foreign = await seedJob('Graduate Software Engineer Three', desc, {
      locationCity: 'Berlin',
      locationCountry: 'Germany',
      locationText: 'Berlin, Germany',
    });
    const remoteForeign = await seedJob('Graduate Software Engineer Four', desc, {
      isRemote: true,
      locationCity: null,
      locationCountry: 'United States',
      locationText: 'Remote - United States',
    });

    await service.classifyPending({
      batch: 500,
      maxAiCalls: 0,
      jobIds: [indian, remoteAnywhere, foreign, remoteForeign],
    });

    expect((await statusOf(indian)).status).toBe('CLASSIFIED');
    expect((await statusOf(remoteAnywhere)).status).toBe('CLASSIFIED');
    // Filtered, not deleted — a preferences change can requeue them (docs 02 §8).
    expect((await statusOf(foreign)).status).toBe('FILTERED_OUT');
    expect((await statusOf(remoteForeign)).status).toBe('FILTERED_OUT');
  }, 60_000);

  it('requeues classified jobs so a preferences change can be re-applied', async () => {
    const mine = (status: ('CLASSIFIED' | 'FILTERED_OUT' | 'DISCOVERED')[]) =>
      db
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.companyId, companyId), inArray(jobs.status, status)));

    const mineIds = (await mine(['CLASSIFIED', 'FILTERED_OUT'])).map((r) => r.id);
    const before = mineIds.length;
    expect(before).toBeGreaterThan(0);
    // Scoped to this suite's own fixtures: the global form takes the first `limit` rows of a
    // table holding thousands of real postings, which may not include any of ours (D80).
    const requeued = await service.requeueFiltered(1000, mineIds);
    expect(requeued).toBe(before);
    expect((await mine(['DISCOVERED'])).length).toBe(before);
  }, 60_000);

  it('re-filters listed jobs that fail the current gates, never one the user saved (D86)', async () => {
    const senior = 'Senior Staff Software Engineer, Platform';
    const seniorText = 'You have 8+ years of professional experience building distributed systems.';
    const listedSenior = await seedJob(senior, seniorText, { status: 'MATCHED' });
    const savedSenior = await seedJob(`${senior} (saved)`, seniorText, { status: 'VALID' });
    const fresher = await seedJob(
      'Software Engineer - Fresher',
      'Freshers welcome. 0-1 years of experience. Graduates of any batch may apply.',
      { status: 'VALID' },
    );
    await db.insert(savedJobs).values({ userId, jobId: savedSenior });
    const ids = [listedSenior, savedSenior, fresher];

    // A dry run reports without writing.
    const dry = await service.refilterListed({ apply: false, jobIds: ids });
    expect(dry.checked).toBe(2); // the saved job is not even considered
    expect(dry.filtered.map((f) => f.id)).toEqual([listedSenior]);
    expect((await statusOf(listedSenior)).status).toBe('MATCHED');

    await service.refilterListed({ apply: true, jobIds: ids });
    expect((await statusOf(listedSenior)).status).toBe('FILTERED_OUT');
    expect((await statusOf(savedSenior)).status).toBe('VALID');
    expect((await statusOf(fresher)).status).toBe('VALID');
    const events = await db
      .select({ detail: jobEvents.detail })
      .from(jobEvents)
      .where(and(eq(jobEvents.jobId, listedSenior), eq(jobEvents.type, 'FILTERED_OUT')));
    expect(JSON.stringify(events)).toContain('re-filtered');

    await db.delete(savedJobs).where(eq(savedJobs.jobId, savedSenior));
  }, 60_000);
});
