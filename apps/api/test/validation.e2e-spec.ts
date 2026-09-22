import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { and, eq, inArray } from 'drizzle-orm';
import type { AIRequest, AIResult, AIService } from '@jobsentinel/ai';
import { normalizeCompanyName } from '@jobsentinel/validation';
import { AI_SERVICE } from '../src/common/ai/ai.module';
import { DB, type Db } from '../src/common/db/db.module';
import { companies, jobEvents, jobValidation, jobs } from '../src/common/db/schema';
import { HTTP_CLIENT } from '../src/common/http/http.module';
import { ValidationOrchestrator } from '../src/validation/validation.orchestrator';
import { WorkerModule } from '../src/worker.module';
import { FakeHttpClient, type FakeRoute } from './helpers/fake-http';

/**
 * Validation engine against the live DB with recorded application pages (docs 08).
 * Covers: verified company + ATS link → VALID, closed page → EXPIRED, fee-scam → SUSPICIOUS,
 * unknown company → NEEDS_REVIEW, blocked page → NEEDS_REVIEW (never punished), AI bounded.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIf = hasDb ? describe : describe.skip;

const page = (name: string) => readFileSync(join(__dirname, 'fixtures/pages', name), 'utf8');

class FakeAi {
  readonly calls: AIRequest<unknown>[] = [];
  constructor(private readonly script: { data?: unknown; fail?: boolean } = { fail: true }) {}
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
    return Promise.resolve({ status: 'ERROR', error: 'scripted failure' });
  }
}

describeIf('validation engine (integration)', () => {
  const tag = `valid-${Date.now()}`;
  let db: Db;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let orchestrator: ValidationOrchestrator;
  let http: FakeHttpClient;
  let fakeAi: FakeAi;
  const companyIds: Record<string, string> = {};

  const routes: Record<string, FakeRoute | FakeRoute[]> = {
    'https://boards.greenhouse.io/acmepay/jobs/1': { body: page('open-greenhouse.html') },
    'https://boards.greenhouse.io/acmepay/jobs/closed': { body: page('closed-greenhouse.html') },
    'https://jobs.lever.co/acmepay/closed': { body: page('closed-lever.html') },
    'https://acmepay.example/careers/404': { status: 404, body: page('not-found.html') },
    'https://acmepay.example': { body: '<html><body>Acme Pay</body></html>' },
    'https://random-jobs.xyz/apply/9': { body: page('scam-fee.html') },
    'https://random-jobs.xyz': { body: '<html><body>jobs</body></html>' },
    'https://careers.unknownco.example/job/5': { status: 403, body: page('blocked.html') },
    'https://unknownco.example': { status: 403, body: 'blocked' },
    'https://acmepay.example/careers/honest': { body: page('honest-warning.html') },
  };

  const build = async (aiScript?: { data?: unknown; fail?: boolean }) => {
    http = new FakeHttpClient(routes);
    fakeAi = new FakeAi(aiScript);
    moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(HTTP_CLIENT)
      .useValue(http)
      .overrideProvider(AI_SERVICE)
      .useValue(fakeAi as unknown as AIService)
      .compile();
    db = moduleRef.get(DB);
    orchestrator = moduleRef.get(ValidationOrchestrator);
  };

  const seedCompany = async (name: string, extra: Partial<typeof companies.$inferInsert> = {}) => {
    const [row] = await db
      .insert(companies)
      .values({
        name: `${tag} ${name}`,
        normalizedName: normalizeCompanyName(`${tag} ${name}`),
        ...extra,
      })
      .returning({ id: companies.id });
    companyIds[name] = row!.id;
    return row!.id;
  };

  const seedJob = async (
    companyId: string,
    title: string,
    applicationUrl: string,
    description: string,
  ) => {
    const [row] = await db
      .insert(jobs)
      .values({
        companyId,
        title,
        normalizedTitle: title.toLowerCase(),
        description,
        sourceUrl: applicationUrl,
        applicationUrl,
        dedupeKey: `${tag}-${title}-${applicationUrl}`,
        status: 'CLASSIFIED',
        firstSeenAt: new Date('2020-01-01T00:00:00Z'),
      })
      .returning({ id: jobs.id });
    return row!.id;
  };

  const jobOf = async (id: string) => (await db.query.jobs.findFirst({ where: eq(jobs.id, id) }))!;
  const validationOf = async (id: string) =>
    (await db.query.jobValidation.findFirst({ where: eq(jobValidation.jobId, id) }))!;

  beforeAll(async () => {
    await build();
    await seedCompany('AcmePay', {
      websiteDomain: 'acmepay.example',
      atsProvider: 'greenhouse',
      atsSlug: 'acmepay',
      isTrusted: true,
    });
    await seedCompany('RandomJobs', { websiteDomain: 'random-jobs.xyz' });
    await seedCompany('UnknownCo', {});
    await seedCompany('BlockedCo', { websiteDomain: 'acmepay.example', isBlocked: true });
  }, 60_000);

  afterAll(async () => {
    const ids = Object.values(companyIds);
    await db.delete(jobs).where(inArray(jobs.companyId, ids));
    await db.delete(companies).where(inArray(companies.id, ids));
    await moduleRef.close();
  }, 60_000);

  it('a trusted company with a matching ATS link and a live page is VALID', async () => {
    const id = await seedJob(
      companyIds.AcmePay!,
      'Software Engineer',
      'https://boards.greenhouse.io/acmepay/jobs/1',
      'Build our payments platform. 0-2 years.',
    );
    await orchestrator.validatePending({ batch: 5, maxAiCalls: 0 });

    const job = await jobOf(id);
    expect(job).toMatchObject({ status: 'VALID', validationStatus: 'VALID' });
    expect(Number(job.validationConfidence)).toBeGreaterThanOrEqual(0.7);
    expect(job.nextCheckAt).not.toBeNull(); // re-check scheduled

    const v = await validationOf(id);
    expect(v).toMatchObject({
      companyVerified: true,
      applicationVerified: true,
      jobActive: true,
      urlStatus: 'OK',
      urlDomainRelationship: 'KNOWN_ATS',
    });
    const checks = (v.evidence as { check: string }[]).map((e) => e.check);
    expect(checks).toEqual(
      expect.arrayContaining([
        'COMPANY_TRUSTED',
        'SOURCE_IS_ATS_BOARD',
        'URL_DOMAIN_RELATIONSHIP',
        'APPLY_FORM_PRESENT',
      ]),
    );
  }, 60_000);

  it.each([
    ['closed-greenhouse', 'https://boards.greenhouse.io/acmepay/jobs/closed'],
    ['closed-lever', 'https://jobs.lever.co/acmepay/closed'],
    ['404', 'https://acmepay.example/careers/404'],
  ])(
    'a %s application page makes the job EXPIRED and stops re-checks',
    async (name, url) => {
      const id = await seedJob(companyIds.AcmePay!, `Engineer ${name}`, url, 'Build things.');
      await orchestrator.validatePending({ batch: 5, maxAiCalls: 0 });
      const job = await jobOf(id);
      expect(job).toMatchObject({ status: 'EXPIRED', validationStatus: 'EXPIRED' });
      expect(job.nextCheckAt).toBeNull();
      expect(job.closedAt).not.toBeNull();
      expect((await validationOf(id)).jobActive).toBe(false);
    },
    60_000,
  );

  it('a fee-demanding posting is SUSPICIOUS with readable flags, whatever the AI says', async () => {
    await moduleRef.close();
    await build({ data: { verdict: 'LEGIT', confidence: 1, reasons: ['looks fine to me'] } });
    const id = await seedJob(
      companyIds.RandomJobs!,
      'Software Engineer Freshers',
      'https://random-jobs.xyz/apply/9',
      'Pay a registration fee of Rs 750 to confirm your seat. Direct joining, no interview required. Share your Aadhaar and bank account details.',
    );
    await orchestrator.validatePending({ batch: 5, maxAiCalls: 3 });

    const job = await jobOf(id);
    expect(job.status).toBe('SUSPICIOUS');
    const v = await validationOf(id);
    expect(v.suspiciousFlags).toEqual(
      expect.arrayContaining(['FEE_REQUEST', 'NO_INTERVIEW', 'SENSITIVE_INFO_REQUEST']),
    );
    expect(Number(v.confidence)).toBeLessThanOrEqual(0.35);
  }, 60_000);

  it('an unverifiable company whose page is blocked becomes NEEDS_REVIEW, not SUSPICIOUS', async () => {
    const id = await seedJob(
      companyIds.UnknownCo!,
      'Backend Engineer',
      'https://careers.unknownco.example/job/5',
      'Join our team to build services.',
    );
    await orchestrator.validatePending({ batch: 5, maxAiCalls: 0 });
    const job = await jobOf(id);
    expect(job.status).toBe('NEEDS_REVIEW');
    const v = await validationOf(id);
    expect(v.urlStatus).toBe('BLOCKED');
    expect(v.applicationVerified).toBe(false);
    const checks = (v.evidence as { check: string }[]).map((e) => e.check);
    expect(checks).toContain('PAGE_BLOCKED'); // recorded, but weighted zero
  }, 60_000);

  it('a blocked company is rejected outright', async () => {
    const id = await seedJob(
      companyIds.BlockedCo!,
      'Software Engineer',
      'https://boards.greenhouse.io/acmepay/jobs/1',
      'Anything.',
    );
    await orchestrator.validatePending({ batch: 5, maxAiCalls: 0 });
    expect((await jobOf(id)).status).toBe('REJECTED');
  }, 60_000);

  it('does not punish a posting that warns about fee scams', async () => {
    const id = await seedJob(
      companyIds.AcmePay!,
      'Graduate Engineer Trainee',
      'https://acmepay.example/careers/honest',
      'We never charge any registration fee at any stage. We will never ask for your bank details.',
    );
    await orchestrator.validatePending({ batch: 5, maxAiCalls: 0 });
    const v = await validationOf(id);
    expect(v.suspiciousFlags).not.toContain('FEE_REQUEST');
    expect((await jobOf(id)).status).toBe('VALID');
  }, 60_000);

  it('a re-check turns a job that closed after discovery into EXPIRED', async () => {
    const id = await seedJob(
      companyIds.AcmePay!,
      'Platform Engineer',
      'https://boards.greenhouse.io/acmepay/jobs/1',
      'Build things.',
    );
    await orchestrator.validatePending({ batch: 5, maxAiCalls: 0 });
    expect((await jobOf(id)).status).toBe('VALID');

    // the posting closes, and the re-check becomes due
    routes['https://boards.greenhouse.io/acmepay/jobs/1'] = {
      body: page('closed-greenhouse.html'),
    };
    await db
      .update(jobs)
      .set({ nextCheckAt: new Date(Date.now() - 1000) })
      .where(eq(jobs.id, id));
    const result = await orchestrator.recheckDue({ batch: 10 });

    expect(result.expired).toBeGreaterThanOrEqual(1);
    const job = await jobOf(id);
    expect(job.status).toBe('EXPIRED');
    const events = await db
      .select()
      .from(jobEvents)
      .where(and(eq(jobEvents.jobId, id), eq(jobEvents.type, 'EXPIRED')));
    expect(events).toHaveLength(1);
    routes['https://boards.greenhouse.io/acmepay/jobs/1'] = { body: page('open-greenhouse.html') };
  }, 60_000);
});
