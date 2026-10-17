import './helpers/test-env';
import { Test } from '@nestjs/testing';
import { eq, inArray } from 'drizzle-orm';
import { DB, type Db } from '../src/common/db/db.module';
import { jobSources, scanRuns } from '../src/common/db/schema';
import { HTTP_CLIENT } from '../src/common/http/http.module';
import { SchedulerService } from '../src/scheduler/scheduler.service';
import { SourceManager } from '../src/sources/source-manager';
import { WorkerModule } from '../src/worker.module';
import { FakeHttpClient } from './helpers/fake-http';

/**
 * Adzuna's published quota is never exceeded, and the adapter's own minimum interval is always
 * honoured (F3, D108). Runs on the local test stack, where Adzuna's usage starts at zero.
 */
const hasDb = Boolean(process.env.DATABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const describeIf = hasDb ? describe : describe.skip;

describeIf('provider quota and scan interval floor (D108)', () => {
  const tag = `quota-${Date.now()}`;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let db: Db;
  let http: FakeHttpClient;
  let sourceId: string;
  let ledgerSourceId: string;

  beforeAll(async () => {
    http = new FakeHttpClient({});
    moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(HTTP_CLIENT)
      .useValue(http)
      .compile();
    db = moduleRef.get(DB);
    const [s] = await db
      .insert(jobSources)
      .values({
        name: `${tag} adzuna`,
        type: 'PUBLIC_API',
        adapter: 'adzuna',
        config: { what: tag },
      })
      .returning({ id: jobSources.id });
    sourceId = s!.id;
    // Another Adzuna source that already spent most of today's quota: usage is per provider.
    const [l] = await db
      .insert(jobSources)
      .values({ name: `${tag} adzuna ledger`, type: 'PUBLIC_API', adapter: 'adzuna', config: {} })
      .returning({ id: jobSources.id });
    ledgerSourceId = l!.id;
  }, 60_000);

  afterAll(async () => {
    await db.delete(jobSources).where(inArray(jobSources.id, [sourceId, ledgerSourceId]));
    await moduleRef.close();
  });

  const source = async () =>
    (await moduleRef.get(SchedulerService).leaseDueSources(10, [sourceId]))[0]!;

  it('refuses a scan — even a manual one — that would pass 90% of the daily quota, making no request', async () => {
    // 224 of 250 used in the last 24 h: one more 2-page scan would reach 226 > 225 (90%).
    await db.insert(scanRuns).values({
      sourceId: ledgerSourceId,
      trigger: 'SCHEDULED',
      startedAt: new Date(Date.now() - 3_600_000),
      completedAt: new Date(Date.now() - 3_590_000),
      status: 'SUCCEEDED',
      requestsMade: 224,
    });
    const before = http.requests.length;
    const runsBefore = await db.select().from(scanRuns).where(eq(scanRuns.sourceId, sourceId));

    const summary = await moduleRef.get(SourceManager).runScan(await source(), 'MANUAL');

    expect(summary.status).toBe('SKIPPED_QUOTA');
    expect(summary.error).toBe('quota perDay 224/225');
    expect(http.requests.length).toBe(before); // nothing was sent to Adzuna
    const runsAfter = await db.select().from(scanRuns).where(eq(scanRuns.sourceId, sourceId));
    expect(runsAfter).toHaveLength(runsBefore.length); // no run recorded: not a failure
    const [row] = await db
      .select({
        next: jobSources.nextScanAt,
        failures: jobSources.consecutiveFailures,
        lease: jobSources.leaseUntil,
      })
      .from(jobSources)
      .where(eq(jobSources.id, sourceId));
    expect(row!.failures).toBe(0);
    expect(row!.lease).toBeNull();
    expect(row!.next!.getTime()).toBeGreaterThan(Date.now() + 50 * 60_000); // postponed ~1 h
  });

  it('never schedules a source more often than its adapter allows (Adzuna: 6 h)', () => {
    const mgr = moduleRef.get(SourceManager) as unknown as {
      intervalSec(s: { adapter: string; scanIntervalSec: number | null; priority: string }): number;
    };
    // Seeded Adzuna sources had no interval: they fell back to LOW = 1 h. The floor is 6 h now.
    expect(mgr.intervalSec({ adapter: 'adzuna', scanIntervalSec: null, priority: 'LOW' })).toBe(
      21_600,
    );
    expect(mgr.intervalSec({ adapter: 'adzuna', scanIntervalSec: 14_400, priority: 'LOW' })).toBe(
      21_600,
    );
    expect(mgr.intervalSec({ adapter: 'adzuna', scanIntervalSec: 86_400, priority: 'LOW' })).toBe(
      86_400,
    );
  });
});
