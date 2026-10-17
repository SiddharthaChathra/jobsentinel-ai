import './helpers/test-env';
import { Test } from '@nestjs/testing';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';
import type { AIPurpose, AIRequest, AIResult, AIService } from '@jobsentinel/ai';
import { normalizeCompanyName } from '@jobsentinel/validation';
import { AI_SERVICE } from '../src/common/ai/ai.module';
import { DB, type Db } from '../src/common/db/db.module';
import { companies, jobEvents, jobs, preferences, users } from '../src/common/db/schema';
import { HTTP_CLIENT } from '../src/common/http/http.module';
import { ClassificationService } from '../src/jobs/classification.service';
import { WorkerModule } from '../src/worker.module';
import { FakeHttpClient } from './helpers/fake-http';

/**
 * AI category decision for unknown-category jobs (A, D105), against the local test database.
 * The fake AI answers per purpose and per job title, and records every request it receives.
 */
const hasDb = Boolean(process.env.DATABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const describeIf = hasDb ? describe : describe.skip;

type Answer = { category: string; confidence: number } | 'ERROR';

class ScriptedAi {
  readonly calls: AIRequest<unknown>[] = [];
  /** Category answers keyed by job title; experience answers are never scripted (rules decide). */
  categories = new Map<string, Answer>();
  run<T>(req: AIRequest<T>): Promise<AIResult<T>> {
    this.calls.push(req as AIRequest<unknown>);
    const title = /<TITLE>(.*)<\/TITLE>/.exec(req.user)?.[1] ?? '';
    const answer = req.purpose === 'CATEGORY_CLASSIFY' ? this.categories.get(title) : undefined;
    if (!answer || answer === 'ERROR') {
      return Promise.resolve({ status: 'ERROR', error: 'scripted' } as AIResult<T>);
    }
    return Promise.resolve({
      status: 'OK',
      data: { ...answer, evidence: [] } as T,
      provider: 'fake',
      model: 'fake',
      usage: { inputTokens: 1, outputTokens: 1 },
      latencyMs: 1,
      cached: false,
    });
  }
  callsFor(purpose: AIPurpose, title?: string): AIRequest<unknown>[] {
    return this.calls.filter(
      (c) => c.purpose === purpose && (!title || c.user.includes(`<TITLE>${title}</TITLE>`)),
    );
  }
}

describeIf('AI category decision for unknown-category jobs (A, D105)', () => {
  const tag = `catai-${Date.now()}`;
  let db: Db;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let ai: ScriptedAi;
  let service: ClassificationService;
  let companyId: string;
  let userId: string;
  let supa: SupabaseClient;
  // A fresher signal and no category signal: the rules place the experience, not the category.
  const FRESHER_PREVIEW = 'Freshers welcome. 0 years of experience. Apply now.';

  const seed = async (title: string, extra: Partial<typeof jobs.$inferInsert> = {}) => {
    const [row] = await db
      .insert(jobs)
      .values({
        companyId,
        title: `${title}`,
        normalizedTitle: title.toLowerCase(),
        description: FRESHER_PREVIEW,
        sourceUrl: `https://boards.example/${tag}/${encodeURIComponent(title)}`,
        dedupeKey: `${tag}-${title}`,
        status: 'DISCOVERED',
        firstSeenAt: new Date('2020-01-01T00:00:00Z'),
        locationCity: 'Pune',
        locationCountry: 'India',
        locationText: 'Pune, India',
        ...extra,
      })
      .returning({ id: jobs.id });
    return row!.id;
  };
  const get = async (id: string) => (await db.query.jobs.findFirst({ where: eq(jobs.id, id) }))!;
  const classify = (ids: string[]) =>
    service.classifyPending({ batch: 500, maxAiCalls: 50, jobIds: ids });

  beforeAll(async () => {
    ai = new ScriptedAi();
    moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(HTTP_CLIENT)
      .useValue(new FakeHttpClient({}))
      .overrideProvider(AI_SERVICE)
      .useValue(ai as unknown as AIService)
      .compile();
    db = moduleRef.get(DB);
    service = moduleRef.get(ClassificationService);
    const [c] = await db
      .insert(companies)
      .values({ name: `${tag} Co`, normalizedName: normalizeCompanyName(`${tag} Co`) })
      .returning();
    companyId = c!.id;
    supa = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const created = await supa.auth.admin.createUser({
      email: `${tag}@jobsentinel.test`,
      password: `Cat-${Math.random().toString(36).slice(2)}-Pass1!`,
      email_confirm: true,
    });
    if (created.error) throw new Error(created.error.message);
    userId = created.data.user!.id;
    await db.insert(users).values({ id: userId, email: `${tag}@jobsentinel.test` });
    await db
      .insert(preferences)
      .values({ userId, categories: ['SOFTWARE', 'DATA'], graduationYear: 2027 });
  }, 60_000);

  afterAll(async () => {
    await db.delete(jobs).where(eq(jobs.companyId, companyId));
    await db.delete(companies).where(eq(companies.id, companyId));
    await db.delete(users).where(eq(users.id, userId));
    if (userId) await supa.auth.admin.deleteUser(userId);
    await moduleRef.close();
  }, 120_000);

  it('places a confident answer: unknown category → SOFTWARE → classified, asked once', async () => {
    const id = await seed(`${tag} Trainee`);
    ai.categories.set(`${tag} Trainee`, { category: 'SOFTWARE', confidence: 0.9 });
    await classify([id]);
    const job = await get(id);
    expect(job).toMatchObject({ status: 'CLASSIFIED', category: 'SOFTWARE' });
    expect(job.categoryAiAt).not.toBeNull();
    const reqs = ai.callsFor('CATEGORY_CLASSIFY', `${tag} Trainee`);
    expect(reqs).toHaveLength(1);
    // The 50-character description is a board preview, and the model is told so.
    expect(reqs[0]!.user).toContain('<PREVIEW>true</PREVIEW>');
    expect(reqs[0]!.cacheKeyInput).toEqual({ jobId: id });
  });

  it('never asks twice for the same canonical job, even after it is re-queued', async () => {
    const id = await seed(`${tag} Associate`);
    ai.categories.set(`${tag} Associate`, { category: 'DATA', confidence: 0.85 });
    await classify([id]);
    await db.update(jobs).set({ status: 'DISCOVERED' }).where(eq(jobs.id, id));
    await classify([id]);
    expect(ai.callsFor('CATEGORY_CLASSIFY', `${tag} Associate`)).toHaveLength(1);
    expect(await get(id)).toMatchObject({ status: 'CLASSIFIED', category: 'DATA' });
  });

  it.each([
    ['"UNKNOWN"', { category: 'UNKNOWN', confidence: 0.95 }],
    ['low confidence', { category: 'SOFTWARE', confidence: 0.5 }],
  ])('holds a job for review on %s — never classified, never alertable', async (label, answer) => {
    const title = `${tag} Analyst ${label}`;
    const id = await seed(title);
    ai.categories.set(title, answer);
    await classify([id]);
    const job = await get(id);
    expect(job.status).toBe('NEEDS_REVIEW');
    expect(job.category).toBe('UNKNOWN');
    const [held] = await db
      .select({ detail: jobEvents.detail })
      .from(jobEvents)
      .where(and(eq(jobEvents.jobId, id), eq(jobEvents.type, 'HELD')));
    expect((held?.detail as { reason?: string }).reason).toBe('category unknown');
  });

  it.each([
    [
      'on-site abroad (location gate)',
      { locationCountry: 'Germany', locationText: 'Berlin, Germany', locationCity: 'Berlin' },
      /location outside India/,
    ],
    [
      'a 2025-only batch (batch gate)',
      { description: 'Freshers of the 2025 batch only. 0 years.' },
      /targets the 2025 batch/,
    ],
    [
      'a stated 3-year minimum (experience gate)',
      { description: 'Minimum 3 years of experience required.' },
      /asks for/,
    ],
  ])(
    'applies deterministic gates first and never asks the AI for %s',
    async (label, extra, reason) => {
      const title = `${tag} Executive Trainee ${label}`;
      const id = await seed(title, extra);
      // Even a confident AI answer must not be able to rescue it.
      ai.categories.set(title, { category: 'SOFTWARE', confidence: 0.99 });
      await classify([id]);
      expect((await get(id)).status).toBe('FILTERED_OUT');
      expect(ai.callsFor('CATEGORY_CLASSIFY', title)).toHaveLength(0);
      const [ev] = await db
        .select({ detail: jobEvents.detail })
        .from(jobEvents)
        .where(and(eq(jobEvents.jobId, id), eq(jobEvents.type, 'FILTERED_OUT')));
      expect((ev?.detail as { reason?: string }).reason).toMatch(reason);
    },
  );

  it('filters a confident non-monitored answer as "category not monitored"', async () => {
    const title = `${tag} Junior Associate sales`;
    const id = await seed(title);
    ai.categories.set(title, { category: 'NON_ENGINEERING', confidence: 0.9 });
    await classify([id]);
    expect(await get(id)).toMatchObject({ status: 'FILTERED_OUT', category: 'NON_ENGINEERING' });
  });

  it('waits when the AI cannot answer, then holds for review — never filters it unasked', async () => {
    const title = `${tag} Trainee outage`;
    const id = await seed(title);
    ai.categories.set(title, 'ERROR');
    await classify([id]);
    expect((await get(id)).status).toBe('DISCOVERED'); // deferred
    await db.update(jobs).set({ stageAttempts: 4 }).where(eq(jobs.id, id));
    await classify([id]);
    const job = await get(id);
    expect(job.status).toBe('NEEDS_REVIEW');
    expect(job.categoryAiAt).toBeNull(); // never answered, so it may be asked later
  });
});
