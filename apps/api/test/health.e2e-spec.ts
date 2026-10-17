import './helpers/test-env';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const describeIf = process.env.DATABASE_URL ? describe : describe.skip;

describeIf('health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });
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
});
