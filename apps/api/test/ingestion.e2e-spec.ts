import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import { normalizeCompanyName } from '@jobsentinel/validation';
import { z } from 'zod';
import { DB, type Db } from '../src/common/db/db.module';
import {
  companies,
  jobEvents,
  jobSourceMappings,
  jobSources,
  jobs,
  scanRuns,
} from '../src/common/db/schema';
import { HTTP_CLIENT } from '../src/common/http/http.module';
import { RecoveryService } from '../src/scheduler/recovery.service';
import { SchedulerService } from '../src/scheduler/scheduler.service';
import type { FetchContext, JobSource, RawJob, SourceMetadata } from '../src/sources/job-source';
import { SourceBlockedError } from '../src/sources/job-source';
import { SourceManager } from '../src/sources/source-manager';
import { SourceRegistry } from '../src/sources/source-registry';
import { WorkerModule } from '../src/worker.module';
import { FakeHttpClient } from './helpers/fake-http';

/**
 * Ingestion pipeline against the live DB with a scripted in-memory adapter (no network):
 * discovery, idempotent re-scan, content update, cross-source attach, failure backoff,
 * blocked-source self-disable and crash recovery (docs 06 §6–7, 07 §2).
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIf = hasDb ? describe : describe.skip;

type Script = { jobs?: RawJob[]; throws?: Error };

class FixtureAdapter implements JobSource<{ key: string }> {
  readonly metadata: SourceMetadata = {
    adapter: 'fixture',
    label: 'Fixture',
    type: 'ATS_API',
    defaultPriority: 'NORMAL',
    supportsSince: false,
    supportsCursor: false,
    politenessMs: 0,
    minIntervalSec: 1,
  };
  readonly configSchema = z.object({ key: z.string() });
  readonly scripts = new Map<string, Script>();
  validateSource() {
    return Promise.resolve({ ok: true, message: 'ok' });
  }
  async *fetchJobs(config: { key: string }, _ctx: FetchContext): AsyncIterable<RawJob> {
    const script = this.scripts.get(config.key) ?? {};
    if (script.throws) throw script.throws;
    for (const j of script.jobs ?? []) yield j;
  }
}

const runId = Date.now();
const rawJob = (id: string, overrides: Partial<RawJob> = {}): RawJob => ({
  externalId: id,
  title: `Software Engineer ${id}`,
  locationText: 'Bengaluru, India',
  descriptionHtml: `<p>Job ${id}: build APIs with Python and SQL. Fresher friendly, 0-1 years.</p>`,
  sourceUrl: `https://boards.example/fixture-${runId}/jobs/${id}`,
  applicationUrl: `https://boards.example/fixture-${runId}/jobs/${id}`,
  postedAt: new Date('2026-09-20T00:00:00Z'),
  ...overrides,
});

describeIf('ingestion pipeline (integration)', () => {
  const tag = `ingest-${Date.now()}`;
  let db: Db;
  let manager: SourceManager;
  let scheduler: SchedulerService;
  let recovery: RecoveryService;
  const adapter = new FixtureAdapter();
  let companyId: string;
  let sourceA: typeof jobSources.$inferSelect;
  let sourceB: typeof jobSources.$inferSelect;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(HTTP_CLIENT)
      .useValue(new FakeHttpClient({}))
      .compile();
    db = moduleRef.get(DB);
    manager = moduleRef.get(SourceManager);
    scheduler = moduleRef.get(SchedulerService);
    recovery = moduleRef.get(RecoveryService);
    moduleRef.get(SourceRegistry).register(adapter as unknown as JobSource<unknown>);

    const [c] = await db
      .insert(companies)
      .values({
        name: `${tag} Co`,
        normalizedName: normalizeCompanyName(`${tag} Co`),
        websiteDomain: 'example.com',
        isTrusted: true,
      })
      .returning();
    companyId = c!.id;
    const [a, b] = await db
      .insert(jobSources)
      .values([
        {
          name: `${tag}-A`,
          type: 'ATS_API',
          adapter: 'fixture',
          config: { key: 'A' },
          companyId,
          priority: 'HIGH',
          scanIntervalSec: 600,
          nextScanAt: sql`now()`,
        },
        {
          name: `${tag}-B`,
          type: 'ATS_API',
          adapter: 'fixture',
          config: { key: 'B' },
          companyId,
          priority: 'LOW',
          scanIntervalSec: 600,
          nextScanAt: sql`now()`,
        },
      ])
      .returning();
    sourceA = a!;
    sourceB = b!;
  }, 60_000);

  afterAll(async () => {
    await db.delete(jobs).where(eq(jobs.companyId, companyId));
    await db.delete(jobSources).where(sql`${jobSources.name} like ${`${tag}-%`}`);
    await db.delete(companies).where(sql`${companies.normalizedName} like 'ingest %'`);
    await moduleRef.close();
  }, 60_000);

  const reload = async (id: string) =>
    (await db.query.jobSources.findFirst({ where: eq(jobSources.id, id) }))!;
  const jobCount = () => db.$count(jobs, eq(jobs.companyId, companyId));

  it('discovers new jobs, records the scan and advances the cursor to the scan start', async () => {
    adapter.scripts.set('A', { jobs: [rawJob('1'), rawJob('2'), rawJob('3')] });
    const summary = await manager.runScan(sourceA, 'SCHEDULED');
    expect(summary).toMatchObject({
      status: 'SUCCEEDED',
      found: 3,
      new: 3,
      updated: 0,
      attached: 0,
      skipped: 0,
    });
    expect(await jobCount()).toBe(3);
    const src = await reload(sourceA.id);
    expect(src.status).toBe('ACTIVE');
    expect(src.consecutiveFailures).toBe(0);
    expect(src.lastSuccessfulScan).not.toBeNull();
    expect(src.nextScanAt!.getTime()).toBeGreaterThan(Date.now() + 500_000);
    const run = await db.query.scanRuns.findFirst({ where: eq(scanRuns.id, summary.scanRunId) });
    expect(run).toMatchObject({ status: 'SUCCEEDED', jobsFound: 3, jobsNew: 3 });
    const events = await db
      .select()
      .from(jobEvents)
      .innerJoin(jobs, eq(jobs.id, jobEvents.jobId))
      .where(eq(jobs.companyId, companyId));
    expect(events.filter((e) => e.job_events.type === 'DISCOVERED')).toHaveLength(3);
  });

  it('a re-scan with identical content changes nothing', async () => {
    const summary = await manager.runScan(await reload(sourceA.id), 'SCHEDULED');
    expect(summary).toMatchObject({ found: 3, new: 0, updated: 0, attached: 0 });
    expect(await jobCount()).toBe(3);
  });

  it('a changed description is an UPDATE, a changed apply URL clears the final URL', async () => {
    adapter.scripts.set('A', {
      jobs: [
        rawJob('1', {
          descriptionHtml: '<p>Job 1: now also needs Docker.</p>',
          applicationUrl: `https://boards.example/fixture-${runId}/apply/1`,
        }),
        rawJob('2'),
        rawJob('3'),
      ],
    });
    const summary = await manager.runScan(await reload(sourceA.id), 'SCHEDULED');
    expect(summary).toMatchObject({ found: 3, new: 0, updated: 1, attached: 0 });
    const job = await db.query.jobs.findFirst({
      where: sql`${jobs.companyId} = ${companyId} and ${jobs.title} = 'Software Engineer 1'`,
    });
    expect(job!.description).toContain('Docker');
    expect(job!.applicationUrl).toBe(`https://boards.example/fixture-${runId}/apply/1`);
    expect(job!.finalApplicationUrl).toBeNull();
  });

  it('a second source listing the same posting attaches a mapping instead of a new job', async () => {
    adapter.scripts.set('B', {
      jobs: [
        rawJob('b-1', {
          title: 'Software Engineer 2 (Fresher)',
          applicationUrl: 'https://other.example/x/2',
        }),
        rawJob('b-9', { title: 'Data Analyst', locationText: 'Pune' }),
      ],
    });
    const summary = await manager.runScan(sourceB, 'SCHEDULED');
    expect(summary).toMatchObject({ found: 2, new: 1, attached: 1 });
    expect(await jobCount()).toBe(4);
    const mappings = await db
      .select()
      .from(jobSourceMappings)
      .innerJoin(jobs, eq(jobs.id, jobSourceMappings.jobId))
      .where(sql`${jobs.title} = 'Software Engineer 2' and ${jobs.companyId} = ${companyId}`);
    expect(mappings).toHaveLength(2);
    expect(mappings.map((m) => m.job_source_mappings.isPrimary).sort()).toEqual([false, true]);
  });

  it('a failing source backs off without touching the cursor; a blocked one disables itself', async () => {
    const before = await reload(sourceA.id);
    adapter.scripts.set('A', { throws: new Error('ECONNRESET') });
    const s1 = await manager.runScan(before, 'SCHEDULED');
    expect(s1.status).toBe('FAILED');
    let src = await reload(sourceA.id);
    expect(src).toMatchObject({ status: 'DEGRADED', consecutiveFailures: 1 });
    expect(src.lastSuccessfulScan!.getTime()).toBe(before.lastSuccessfulScan!.getTime());
    expect(src.lastError).toContain('ECONNRESET');

    adapter.scripts.set('A', { throws: new SourceBlockedError('forbidden', 403) });
    await manager.runScan(await reload(sourceA.id), 'SCHEDULED');
    await manager.runScan(await reload(sourceA.id), 'SCHEDULED');
    src = await reload(sourceA.id);
    expect(src).toMatchObject({ status: 'DISABLED', enabled: false, consecutiveFailures: 3 });
    // a healthy scan after re-enabling resets everything
    await db
      .update(jobSources)
      .set({ enabled: true, status: 'ACTIVE' })
      .where(eq(jobSources.id, sourceA.id));
    adapter.scripts.set('A', { jobs: [rawJob('1'), rawJob('2'), rawJob('3')] });
    await manager.runScan(await reload(sourceA.id), 'SCHEDULED');
    src = await reload(sourceA.id);
    expect(src).toMatchObject({ status: 'ACTIVE', consecutiveFailures: 0, lastError: null });
  });

  it('scheduler leases only due sources and a manual request jumps the queue', async () => {
    await db
      .update(jobSources)
      .set({ nextScanAt: sql`now() + interval '1 hour'`, leaseUntil: null })
      .where(sql`${jobSources.name} like ${`${tag}-%`}`);
    expect(
      (await scheduler.leaseDueSources(10)).filter((s) => s.name.startsWith(tag)),
    ).toHaveLength(0);
    await scheduler.requestManualScan(sourceB.id);
    const leased = (await scheduler.leaseDueSources(10)).filter((s) => s.name.startsWith(tag));
    expect(leased.map((s) => s.name)).toEqual([`${tag}-B`]);
    expect((await reload(sourceB.id)).leaseUntil).not.toBeNull();
  });

  it('recovery sweep repairs an orphaned run and an expired lease', async () => {
    await db.insert(scanRuns).values({
      sourceId: sourceB.id,
      status: 'RUNNING',
      startedAt: sql`now() - interval '2 hours'`,
    });
    await db
      .update(jobSources)
      .set({ leaseUntil: sql`now() - interval '1 minute'` })
      .where(eq(jobSources.id, sourceB.id));
    const result = await recovery.sweep();
    expect(result.orphanedRuns).toBeGreaterThanOrEqual(1);
    expect(result.expiredLeases).toBeGreaterThanOrEqual(1);
    const runs = await db
      .select()
      .from(scanRuns)
      .where(
        sql`${scanRuns.sourceId} = ${sourceB.id} and ${scanRuns.errorMessage} like 'orphaned%'`,
      );
    expect(runs).toHaveLength(1);
    expect((await reload(sourceB.id)).leaseUntil).toBeNull();
  });
});
