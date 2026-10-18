import './helpers/test-env';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module';
import { DB, type Db } from '../src/common/db/db.module';
import { workerHeartbeats } from '../src/common/db/schema';

const describeIf = process.env.DATABASE_URL ? describe : describe.skip;

describeIf('health (e2e)', () => {
  let app: INestApplication;
  let db: Db;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    db = moduleRef.get(DB);
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready', 'health/worker'] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok with version', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', version: expect.any(String) });
    expect(res.body.uptimeSec).toBeGreaterThanOrEqual(0);
  });

  it('GET /health/ready returns readiness checks', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks).toBeDefined();
  });

  // Test database only: the heartbeat table is the worker's, rewritten here to stage each case.
  it('GET /health/worker: 503 when the last beat is older than 2× the interval, 200 after a fresh beat, no token needed', async () => {
    await db.execute(sql`delete from worker_heartbeats`);
    const stale = new Date(Date.now() - 61 * 60_000); // interval 30 min → threshold 60
    await db.insert(workerHeartbeats).values({
      workerId: 'health-e2e',
      hostname: 'test',
      version: 'test',
      startedAt: stale,
      lastBeatAt: stale,
      currentTask: 'done',
      once: 1,
    });
    const down = await request(app.getHttpServer()).get('/health/worker').expect(503);
    expect(down.body).toMatchObject({ status: 'unhealthy', thresholdMin: 60 });
    expect(down.body.ageMin).toBeGreaterThanOrEqual(61);

    await db
      .update(workerHeartbeats)
      .set({ lastBeatAt: new Date() })
      .where(sql`worker_id = 'health-e2e'`);
    const up = await request(app.getHttpServer()).get('/health/worker').expect(200);
    expect(up.body).toMatchObject({ status: 'ok', ageMin: 0 });
    await db.execute(sql`delete from worker_heartbeats where worker_id = 'health-e2e'`);
  });
});
