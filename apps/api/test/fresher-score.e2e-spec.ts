import './helpers/test-env';
import { Test } from '@nestjs/testing';
import { eq, inArray } from 'drizzle-orm';
import { JobsQuery } from '@jobsentinel/types';
import { aggregatePostings, fresherScore, normalizeCompanyName } from '@jobsentinel/validation';
import { DB, type Db } from '../src/common/db/db.module';
import {
  companies,
  companyFresherStats,
  jobEvents,
  jobSources,
  jobs,
} from '../src/common/db/schema';
import { HTTP_CLIENT } from '../src/common/http/http.module';
import { SchedulerService } from '../src/scheduler/scheduler.service';
import { CompanyFresherService } from '../src/sources/company-fresher.service';
import { SourceManager } from '../src/sources/source-manager';
import { JobsQueryService } from '../src/jobs/jobs-query.service';
import { WorkerModule } from '../src/worker.module';
import { FakeHttpClient } from './helpers/fake-http';

/**
 * Company "accepts freshers" score (F4, D118): the SQL sums equal the documented formula, fewer
 * than 5 postings is UNKNOWN, the band spaces a company board's scans — and nothing about a job
 * changes because of it.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIf = hasDb ? describe : describe.skip;

const DAY = 86_400_000;

describeIf('company fresher score (F4, D118)', () => {
  const tag = `fresher-score-${Date.now()}`;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let db: Db;
  let svc: CompanyFresherService;
  const companyIds: Record<'hires' | 'never' | 'few', string> = { hires: '', never: '', few: '' };
  const sourceIds: string[] = [];
  const jobIds: string[] = [];

  type Seed = {
    daysAgo: number;
    fresher: boolean;
    status?: 'VALID' | 'FILTERED_OUT';
    abroad?: boolean;
  };

  const seedJobs = async (companyId: string, list: Seed[]) => {
    for (const [i, s] of list.entries()) {
      const at = new Date(Date.now() - s.daysAgo * DAY);
      const [row] = await db
        .insert(jobs)
        .values({
          companyId,
          title: `Engineer ${i}`,
          normalizedTitle: `engineer ${i}`,
          sourceUrl: `https://boards.example/${tag}/${companyId}/${i}`,
          dedupeKey: `${tag}-${companyId}-${i}`,
          status: s.status ?? 'VALID',
          validationStatus: s.status === 'FILTERED_OUT' ? 'PENDING' : 'VALID',
          postedAt: at,
          firstSeenAt: at,
          experienceLevel: s.fresher ? 'FRESHER' : 'EXPERIENCED',
          experienceMinYears: s.fresher ? '0' : '4',
          locationCity: 'Bengaluru',
          locationCountry: 'India',
          locationText: 'Bengaluru, India',
        })
        .returning({ id: jobs.id });
      jobIds.push(row!.id);
      if (s.status === 'FILTERED_OUT') {
        await db.insert(jobEvents).values({
          jobId: row!.id,
          type: 'FILTERED_OUT',
          detail: { reason: s.abroad ? 'location outside India (Romania)' : 'asks for 4+ years' },
        });
      }
    }
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(HTTP_CLIENT)
      .useValue(new FakeHttpClient({}))
      .compile();
    db = moduleRef.get(DB);
    svc = moduleRef.get(CompanyFresherService);
    for (const key of Object.keys(companyIds) as (keyof typeof companyIds)[]) {
      const name = `${tag} ${key}`;
      const [c] = await db
        .insert(companies)
        .values({ name, normalizedName: normalizeCompanyName(name) })
        .returning({ id: companies.id });
      companyIds[key] = c!.id;
    }
    // 3 fresher (0, 0, 30 days) + 4 others (0, 30, 60, 90): Σall 4.375, Σfresher 2.5 → 57, HIGH
    // (HIGH needs 3 fresher postings, D118 amended).
    // Plus a fresher role abroad that was filtered for location: a posting, not fresher-eligible.
    await seedJobs(companyIds.hires, [
      { daysAgo: 0, fresher: true },
      { daysAgo: 0, fresher: true },
      { daysAgo: 30, fresher: true },
      { daysAgo: 0, fresher: false, status: 'FILTERED_OUT' },
      { daysAgo: 30, fresher: false, status: 'FILTERED_OUT' },
      { daysAgo: 60, fresher: false, status: 'FILTERED_OUT' },
      { daysAgo: 90, fresher: false, status: 'FILTERED_OUT' },
    ]);
    await seedJobs(companyIds.never, [
      { daysAgo: 1, fresher: false },
      { daysAgo: 2, fresher: false },
      { daysAgo: 3, fresher: false },
      { daysAgo: 4, fresher: false },
      { daysAgo: 5, fresher: false },
      { daysAgo: 6, fresher: true, status: 'FILTERED_OUT', abroad: true },
    ]);
    await seedJobs(companyIds.few, [
      { daysAgo: 0, fresher: true },
      { daysAgo: 1, fresher: true },
      { daysAgo: 2, fresher: true },
      { daysAgo: 3, fresher: true },
    ]);
    for (const key of ['hires', 'never'] as const) {
      const [s] = await db
        .insert(jobSources)
        .values({
          name: `${tag} ${key} board`,
          type: 'ATS_API',
          adapter: 'greenhouse',
          companyId: companyIds[key],
          priority: 'NORMAL',
          config: { boardToken: `${tag}-${key}` },
        })
        .returning({ id: jobSources.id });
      sourceIds.push(s!.id);
    }
  }, 60_000);

  afterAll(async () => {
    await db.delete(jobSources).where(inArray(jobSources.id, sourceIds));
    await db.delete(jobs).where(inArray(jobs.id, jobIds));
    await db.delete(companies).where(inArray(companies.id, Object.values(companyIds)));
    await moduleRef.close();
  });

  const statsOf = async (id: string) =>
    (await db.select().from(companyFresherStats).where(eq(companyFresherStats.companyId, id)))[0];

  it('stores what the documented formula gives: 57 HIGH, 0 LOW, UNKNOWN under 5 postings', async () => {
    const statusesBefore = await db
      .select({ id: jobs.id, status: jobs.status })
      .from(jobs)
      .where(inArray(jobs.id, jobIds));

    await svc.recompute(Object.values(companyIds));

    const hires = await statsOf(companyIds.hires);
    expect(hires).toMatchObject({ postingsSeen: 7, fresherCount: 3, score: 57, band: 'HIGH' });
    // SQL and the pure formula agree on the same postings.
    const expected = fresherScore(
      aggregatePostings(
        [0, 0, 30]
          .map((d) => ({ at: new Date(Date.now() - d * DAY), fresher: true }))
          .concat(
            [0, 30, 60, 90].map((d) => ({ at: new Date(Date.now() - d * DAY), fresher: false })),
          ),
        new Date(),
      ),
    );
    expect(hires!.score).toBe(expected.score);
    expect(hires!.weightedAll).toBeCloseTo(4.375, 2);

    // A fresher role abroad, filtered for location, is a posting but not fresher-eligible.
    expect(await statsOf(companyIds.never)).toMatchObject({
      postingsSeen: 6,
      fresherCount: 0,
      score: 0,
      band: 'LOW',
    });
    expect(await statsOf(companyIds.few)).toMatchObject({
      postingsSeen: 4,
      score: null,
      band: 'UNKNOWN',
    });

    // Never a gate: computing scores changed no job.
    const statusesAfter = await db
      .select({ id: jobs.id, status: jobs.status })
      .from(jobs)
      .where(inArray(jobs.id, jobIds));
    expect(new Map(statusesAfter.map((r) => [r.id, r.status]))).toEqual(
      new Map(statusesBefore.map((r) => [r.id, r.status])),
    );
  });

  it('only speeds boards up: HIGH every 15 min, LOW keeps the default 30 (NORMAL)', async () => {
    await svc.recompute(Object.values(companyIds));
    const scheduler = moduleRef.get(SchedulerService);
    const manager = moduleRef.get(SourceManager) as unknown as {
      markSuccess(s: unknown, startedAt: Date, cursor: string | null): Promise<void>;
    };
    const minutesUntilNext = async (id: string) => {
      const [source] = await scheduler.leaseDueSources(1, [id]);
      await manager.markSuccess(source, new Date(), null);
      const [row] = await db
        .select({ next: jobSources.nextScanAt })
        .from(jobSources)
        .where(eq(jobSources.id, id));
      return Math.round((row!.next!.getTime() - Date.now()) / 60_000);
    };
    expect(await minutesUntilNext(sourceIds[0]!)).toBe(15); // hires → HIGH
    expect(await minutesUntilNext(sourceIds[1]!)).toBe(30); // never → LOW: not slowed
  });

  it('leases a HIGH board before a LOW one of the same priority when both are due', async () => {
    // Both requested manually and HIGH priority, so no seeded source outranks them; the LOW
    // board was requested first, so only the band can put the HIGH board ahead.
    const now = Date.now();
    await db
      .update(jobSources)
      .set({
        priority: 'HIGH',
        nextScanAt: new Date(now - 60_000),
        manualRequestedAt: new Date(now - 60_000),
        leaseUntil: null,
      })
      .where(eq(jobSources.id, sourceIds[0]!));
    await db
      .update(jobSources)
      .set({
        priority: 'HIGH',
        nextScanAt: new Date(now - 120_000),
        manualRequestedAt: new Date(now - 120_000),
        leaseUntil: null,
      })
      .where(eq(jobSources.id, sourceIds[1]!));
    const [first] = await moduleRef.get(SchedulerService).leaseDueSources(1);
    expect(first!.id).toBe(sourceIds[0]); // hires → HIGH band
    await db
      .update(jobSources)
      .set({ leaseUntil: null, manualRequestedAt: null, nextScanAt: new Date(now + DAY) })
      .where(inArray(jobSources.id, sourceIds));
  });

  it('marks the company "Hires freshers often" on its cards when HIGH, and only then', async () => {
    await svc.recompute(Object.values(companyIds));
    const list = moduleRef.get(JobsQueryService, { strict: false });
    const viewer = { profileVersion: 1, locations: [], employmentTypes: [] };
    const userId = '00000000-0000-4000-8000-000000000001';
    const cards = async (companyId: string) =>
      (await list.list(userId, JobsQuery.parse({ companyId }), viewer)).items;
    const high = await cards(companyIds.hires);
    expect(high.length).toBeGreaterThan(0);
    expect(high.every((c) => c.company.hiresFreshersOften === true)).toBe(true);
    const unknown = await cards(companyIds.few);
    expect(unknown.length).toBe(4); // UNKNOWN: listed as usual, no badge
    expect(unknown.every((c) => c.company.hiresFreshersOften === false)).toBe(true);
  });
});
