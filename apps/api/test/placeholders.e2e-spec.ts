import './helpers/test-env';
import { Test } from '@nestjs/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { loadEnv } from '@jobsentinel/config';
import type { AIRequest, AIResult, AIService } from '@jobsentinel/ai';
import { normalizeCompanyName } from '@jobsentinel/validation';
import { AI_SERVICE } from '../src/common/ai/ai.module';
import { ENV } from '../src/common/config/config.module';
import { DB, type Db } from '../src/common/db/db.module';
import { companies, jobEvents, jobs } from '../src/common/db/schema';
import { HTTP_CLIENT } from '../src/common/http/http.module';
import { ClassificationService } from '../src/jobs/classification.service';
import { WorkerModule } from '../src/worker.module';
import { FakeHttpClient } from './helpers/fake-http';

/**
 * Placeholder postings (D117): a general application or talent pool is set aside at
 * classification, before every other gate and without the AI — and only when the switch is on.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIf = hasDb ? describe : describe.skip;

class CountingAi {
  readonly calls: AIRequest<unknown>[] = [];
  run<T>(req: AIRequest<T>): Promise<AIResult<T>> {
    this.calls.push(req as AIRequest<unknown>);
    return Promise.resolve({ status: 'ERROR', error: 'not needed' } as AIResult<T>);
  }
}

describeIf('placeholder postings (D117)', () => {
  const tag = `placeholder-${Date.now()}`;
  let companyId: string;

  const build = async (enabled: boolean) => {
    const ai = new CountingAi();
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(HTTP_CLIENT)
      .useValue(new FakeHttpClient({}))
      .overrideProvider(AI_SERVICE)
      .useValue(ai as unknown as AIService)
      .overrideProvider(ENV)
      .useValue({ ...loadEnv(), PLACEHOLDER_FILTER_ENABLED: enabled })
      .compile();
    return { moduleRef, ai, db: moduleRef.get<Db>(DB) };
  };

  const seed = async (db: Db, title: string) => {
    const [row] = await db
      .insert(jobs)
      .values({
        companyId,
        title,
        normalizedTitle: title.toLowerCase(),
        description: 'Freshers welcome. 0 years of experience. Java and SQL.',
        sourceUrl: `https://boards.example/${tag}/${encodeURIComponent(title)}`,
        dedupeKey: `${tag}-${title}`,
        status: 'DISCOVERED',
        locationCity: 'Bengaluru',
        locationCountry: 'India',
        locationText: 'Bengaluru, India',
      })
      .returning({ id: jobs.id });
    return row!.id;
  };

  beforeAll(async () => {
    const { moduleRef, db } = await build(false);
    const [c] = await db
      .insert(companies)
      .values({ name: `${tag} Co`, normalizedName: normalizeCompanyName(`${tag} Co`) })
      .returning({ id: companies.id });
    companyId = c!.id;
    await moduleRef.close();
  }, 60_000);

  afterAll(async () => {
    const { moduleRef, db } = await build(false);
    await db.delete(jobs).where(eq(jobs.companyId, companyId));
    await db.delete(companies).where(eq(companies.id, companyId));
    await moduleRef.close();
  }, 60_000);

  it("sets Sigmoid's posting aside, without the AI, and leaves real titles to the usual gates", async () => {
    const { moduleRef, ai, db } = await build(true);
    try {
      const sigmoid = await seed(db, "Don't see what you're looking for?");
      const trainee = await seed(db, 'Graduate Engineer Trainee');
      const manager = await seed(db, 'General Manager');
      const result = await moduleRef
        .get(ClassificationService)
        .classifyPending({ batch: 50, maxAiCalls: 5, jobIds: [sigmoid, trainee, manager] });
      expect(result.placeholders).toBe(1);

      const rows = await db
        .select({ id: jobs.id, status: jobs.status })
        .from(jobs)
        .where(inArray(jobs.id, [sigmoid, trainee, manager]));
      const status = new Map(rows.map((r) => [r.id, r.status]));
      expect(status.get(sigmoid)).toBe('PLACEHOLDER');
      expect(status.get(trainee)).not.toBe('PLACEHOLDER');
      expect(status.get(manager)).not.toBe('PLACEHOLDER');

      // Not a single AI call was spent on it.
      expect(ai.calls.filter((c) => c.user.includes("Don't see what"))).toHaveLength(0);
      const [ev] = await db
        .select({ detail: jobEvents.detail })
        .from(jobEvents)
        .where(and(eq(jobEvents.jobId, sigmoid), eq(jobEvents.type, 'PLACEHOLDER')));
      expect((ev?.detail as { reason?: string }).reason).toMatch(/^placeholder posting/);
    } finally {
      await moduleRef.close();
    }
  }, 60_000);

  it('does nothing while the switch is off (the default until the owner confirms)', async () => {
    const { moduleRef, db } = await build(false);
    try {
      const pool = await seed(db, 'Join our Talent Community');
      await moduleRef
        .get(ClassificationService)
        .classifyPending({ batch: 50, maxAiCalls: 0, jobIds: [pool] });
      const row = await db.query.jobs.findFirst({ where: eq(jobs.id, pool) });
      expect(row!.status).not.toBe('PLACEHOLDER');
    } finally {
      await moduleRef.close();
    }
  }, 60_000);
});
