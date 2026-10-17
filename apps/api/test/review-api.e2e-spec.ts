import './helpers/test-env';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { normalizeCompanyName } from '@jobsentinel/validation';
import { AppModule } from '../src/app.module';
import { AI_SERVICE } from '../src/common/ai/ai.module';
import { DB, type Db } from '../src/common/db/db.module';
import { companies, jobEvents, jobValidation, jobs } from '../src/common/db/schema';

/** Manual review of SUSPICIOUS / NEEDS_REVIEW jobs (docs 08 §5) — the user has the final word. */
const hasSupabase = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.DATABASE_URL,
);
const describeIf = hasSupabase ? describe : describe.skip;

describeIf('review API (e2e)', () => {
  const tag = `review-${Date.now()}`;
  let app: INestApplication;
  let db: Db;
  let admin: SupabaseClient;
  let userId: string;
  let token: string;
  let companyId: string;

  const seedJob = async (title: string, status: 'NEEDS_REVIEW' | 'SUSPICIOUS') => {
    const [job] = await db
      .insert(jobs)
      .values({
        companyId,
        title,
        normalizedTitle: title.toLowerCase(),
        description: 'A posting awaiting review.',
        sourceUrl: `https://boards.example/${tag}/${encodeURIComponent(title)}`,
        applicationUrl: `https://boards.example/${tag}/${encodeURIComponent(title)}`,
        dedupeKey: `${tag}-${title}`,
        status,
        validationStatus: status === 'SUSPICIOUS' ? 'SUSPICIOUS' : 'NEEDS_REVIEW',
      })
      .returning({ id: jobs.id });
    await db.insert(jobValidation).values({
      jobId: job!.id,
      status: status === 'SUSPICIOUS' ? 'SUSPICIOUS' : 'NEEDS_REVIEW',
      confidence: '0.45',
    });
    return job!.id;
  };

  beforeAll(async () => {
    process.env.ALLOWED_SIGNUP_EMAILS = '*';
    admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const password = `Rev-${Math.random().toString(36).slice(2)}-Pass1!`;
    const created = await admin.auth.admin.createUser({
      email: `${tag}@jobsentinel.test`,
      password,
      email_confirm: true,
    });
    if (created.error) throw new Error(created.error.message);
    userId = created.data.user!.id;
    const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    token = (await anon.auth.signInWithPassword({ email: `${tag}@jobsentinel.test`, password }))
      .data.session!.access_token;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_SERVICE)
      .useValue(null)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });
    await app.init();
    db = moduleRef.get(DB);

    const [c] = await db
      .insert(companies)
      .values({ name: `${tag} Co`, normalizedName: normalizeCompanyName(`${tag} Co`) })
      .returning({ id: companies.id });
    companyId = c!.id;
  }, 60_000);

  afterAll(async () => {
    await db.delete(jobs).where(eq(jobs.companyId, companyId));
    await db.delete(companies).where(inArray(companies.id, [companyId]));
    if (userId) await admin.auth.admin.deleteUser(userId);
    await app?.close();
  }, 60_000);

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('accepting a flagged job makes it VALID and can trust the company for future postings', async () => {
    const id = await seedJob('Graduate Engineer Trainee', 'NEEDS_REVIEW');
    const res = await request(app.getHttpServer())
      .post(`/api/v1/jobs/${id}/review`)
      .set(auth())
      .send({ decision: 'ACCEPT', note: 'I know this company', trustCompany: true })
      .expect(200);
    expect(res.body.data).toEqual({ status: 'VALID', companyTrusted: true });

    const job = (await db.query.jobs.findFirst({ where: eq(jobs.id, id) }))!;
    expect(job).toMatchObject({ status: 'VALID', validationStatus: 'VALID' });
    expect(job.nextCheckAt).not.toBeNull(); // accepted jobs resume the re-check cycle
    const v = (await db.query.jobValidation.findFirst({ where: eq(jobValidation.jobId, id) }))!;
    expect(v.reviewedByUserAt).not.toBeNull();
    expect(v.reviewNote).toBe('I know this company');
    const company = (await db.query.companies.findFirst({ where: eq(companies.id, companyId) }))!;
    expect(company.isTrusted).toBe(true);
    const events = await db.select().from(jobEvents).where(eq(jobEvents.jobId, id));
    expect(events.map((e) => e.type)).toContain('USER_REVIEWED');
  }, 60_000);

  it('rejecting a suspicious job stops it and its re-checks', async () => {
    const id = await seedJob('Data Entry Executive', 'SUSPICIOUS');
    const res = await request(app.getHttpServer())
      .post(`/api/v1/jobs/${id}/review`)
      .set(auth())
      .send({ decision: 'REJECT', note: 'asks for a fee' })
      .expect(200);
    expect(res.body.data.status).toBe('REJECTED');
    const job = (await db.query.jobs.findFirst({ where: eq(jobs.id, id) }))!;
    expect(job).toMatchObject({ status: 'REJECTED', validationStatus: 'INVALID' });
    expect(job.nextCheckAt).toBeNull();
  }, 60_000);

  it('validates the request and refuses unknown or non-reviewable jobs', async () => {
    const bad = await request(app.getHttpServer())
      .post(`/api/v1/jobs/${crypto.randomUUID()}/review`)
      .set(auth())
      .send({ decision: 'ACCEPT' })
      .expect(404);
    expect(bad.body.error.code).toBe('JOB_NOT_FOUND');

    const id = await seedJob('Another Role', 'NEEDS_REVIEW');
    await request(app.getHttpServer())
      .post(`/api/v1/jobs/${id}/review`)
      .set(auth())
      .send({ decision: 'MAYBE' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/jobs/${id}/review`)
      .send({ decision: 'ACCEPT' })
      .expect(401);

    await db.update(jobs).set({ status: 'EXPIRED' }).where(eq(jobs.id, id));
    const conflict = await request(app.getHttpServer())
      .post(`/api/v1/jobs/${id}/review`)
      .set(auth())
      .send({ decision: 'ACCEPT' })
      .expect(409);
    expect(conflict.body.error.code).toBe('JOB_NOT_REVIEWABLE');
  }, 60_000);
});
