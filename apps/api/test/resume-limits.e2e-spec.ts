import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { AIRequest, AIResult, AIService } from '@jobsentinel/ai';
import { AppModule } from '../src/app.module';
import { AI_SERVICE } from '../src/common/ai/ai.module';
import { DB, type Db } from '../src/common/db/db.module';
import { aiCalls } from '../src/common/db/schema';
import { RESUME_AI_PER_USER_PER_DAY } from '../src/resumes/resumes.service';
import { makeTextPdf } from './helpers/pdf';

/**
 * Per-user limit on AI resume analysis (D93): with open sign-up the AI budget is shared by every
 * account, so one user must not be able to spend it. Real user, JWT, DB, storage and PDF parsing;
 * the AI is a fake that only records what it was asked.
 */
const hasSupabase = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.DATABASE_URL,
);
const describeIf = hasSupabase ? describe : describe.skip;

class RecordingAi {
  readonly calls: AIRequest<unknown>[] = [];
  run<T>(req: AIRequest<T>): Promise<AIResult<T>> {
    this.calls.push(req as AIRequest<unknown>);
    // A failure keeps the test independent of the draft schema; the service falls back either way.
    return Promise.resolve({ status: 'ERROR', error: 'scripted' });
  }
}

describeIf('resume AI limit (e2e)', () => {
  let app: INestApplication;
  let admin: SupabaseClient;
  let db: Db;
  let userId: string;
  let token: string;
  let resumeId: string;
  const ai = new RecordingAi();
  const email = `limits-${Date.now()}@jobsentinel.test`;
  const password = `Lim-${Math.random().toString(36).slice(2)}-Pass1!`;

  beforeAll(async () => {
    process.env.ALLOWED_SIGNUP_EMAILS = '*';
    admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    userId = created.data.user.id;
    const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    const signIn = await anon.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
    token = signIn.data.session!.access_token;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_SERVICE)
      .useValue(ai as unknown as AIService)
      .compile();
    db = moduleRef.get(DB);
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });
    await app.init();

    const pdf = makeTextPdf([
      'Limit Tester',
      'B.E. Computer Science, XYZ Institute of Technology, Bengaluru - expected 2027',
      'Skills: Python, TypeScript, React, SQL, Linux, Docker, Git',
      'Projects: Job matching platform (Next.js, NestJS, PostgreSQL)',
      'Internship: Software Engineering Intern, ABC Solutions (Jun 2025 - Aug 2025)',
    ]);
    const res = await request(app.getHttpServer())
      .post('/api/v1/resumes')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', pdf, { filename: 'limits.pdf', contentType: 'application/pdf' })
      .expect(201);
    resumeId = (res.body as { data: { id: string } }).data.id;
  }, 90_000);

  afterAll(async () => {
    if (db && userId) await db.delete(aiCalls).where(eq(aiCalls.userId, userId));
    if (resumeId)
      await request(app.getHttpServer())
        .delete(`/api/v1/resumes/${resumeId}`)
        .set('Authorization', `Bearer ${token}`);
    if (userId) await admin.auth.admin.deleteUser(userId);
    await app?.close();
  }, 60_000);

  const analyze = () =>
    request(app.getHttpServer())
      .post(`/api/v1/resumes/${resumeId}/analyze`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

  it('asks the AI under the limit, attributing the call to the user', async () => {
    await analyze();
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0]?.purpose).toBe('RESUME_PROFILE');
    expect(ai.calls[0]?.meta?.userId).toBe(userId);
  });

  it('uses the deterministic draft, without an AI call, once the limit is reached', async () => {
    // As if this user had already made the day's allowance of real analyses.
    await db.insert(aiCalls).values(
      Array.from({ length: RESUME_AI_PER_USER_PER_DAY }, (_, i) => ({
        provider: 'fake',
        model: 'fake',
        purpose: 'RESUME_PROFILE',
        promptVersion: 'test',
        inputHash: `limits-${i}`,
        status: 'OK',
        userId,
      })),
    );
    const before = ai.calls.length;
    const res = await analyze();
    expect(ai.calls).toHaveLength(before);
    const data = (res.body as { data: { deterministicFallback: boolean } }).data;
    expect(data.deterministicFallback).toBe(true);
  });
});
