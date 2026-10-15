import 'dotenv/config';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const describeIf = process.env.DATABASE_URL ? describe : describe.skip;

/** The sign-up pre-check: public, allow-list driven, validated, throttled (D91). */
describeIf('auth signup-check (e2e)', () => {
  let app: INestApplication;
  const previous = process.env.ALLOWED_SIGNUP_EMAILS;

  beforeAll(async () => {
    process.env.ALLOWED_SIGNUP_EMAILS = 'owner@jobsentinel.test, Second@JobSentinel.test';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });
    await app.init();
  });

  afterAll(async () => {
    process.env.ALLOWED_SIGNUP_EMAILS = previous;
    await app.close();
  });

  const check = (email: unknown) =>
    request(app.getHttpServer()).post('/api/v1/auth/signup-check').send({ email });

  it('needs no token and answers from the allow-list, case-insensitively', async () => {
    expect((await check('owner@jobsentinel.test').expect(200)).body).toEqual({
      data: { allowed: true },
    });
    expect((await check('second@jobsentinel.test').expect(200)).body.data.allowed).toBe(true);
    expect((await check('stranger@jobsentinel.test').expect(200)).body.data.allowed).toBe(false);
  });

  it('rejects a malformed email with the validation envelope', async () => {
    const res = await check('not-an-email').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('is throttled below the global limit', async () => {
    let limited = false;
    for (let i = 0; i < 15 && !limited; i++) {
      limited = (await check(`probe-${i}@jobsentinel.test`)).status === 429;
    }
    expect(limited).toBe(true);
  });
});
