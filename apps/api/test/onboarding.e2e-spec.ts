import './helpers/test-env';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AI_SERVICE } from '../src/common/ai/ai.module';
import { makeTextPdf } from './helpers/pdf';

/**
 * True end-to-end onboarding (docs 16, Phase 2 definition of done):
 * real Supabase Auth user + real JWKS verification + real DB + real storage + real PDF parsing.
 * AI is stubbed out (deterministic fallback) unless AI_LIVE_TESTS=1.
 * Skips itself when Supabase credentials are absent (e.g. CI without secrets).
 */
const hasSupabase = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.DATABASE_URL,
);
const describeIf = hasSupabase ? describe : describe.skip;

describeIf('onboarding (e2e)', () => {
  let app: INestApplication;
  let admin: SupabaseClient;
  let userId: string;
  let token: string;
  let resumeId: string;
  const email = `e2e-${Date.now()}@jobsentinel.test`;
  const password = `E2e-${Math.random().toString(36).slice(2)}-Pass1!`;
  const liveAi = process.env.AI_LIVE_TESTS === '1';

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

    let builder = Test.createTestingModule({ imports: [AppModule] });
    if (!liveAi) builder = builder.overrideProvider(AI_SERVICE).useValue(null);
    const moduleRef = await builder.compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });
    await app.init();
  }, 60_000);

  afterAll(async () => {
    if (resumeId)
      await request(app.getHttpServer())
        .delete(`/api/v1/resumes/${resumeId}`)
        .set('Authorization', `Bearer ${token}`);
    if (userId) await admin.auth.admin.deleteUser(userId); // cascades to users → profiles/preferences/resumes rows
    await app?.close();
  }, 60_000);

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('rejects missing and invalid tokens with the error envelope', async () => {
    const none = await request(app.getHttpServer()).get('/api/v1/me').expect(401);
    expect(none.body.error.code).toBe('UNAUTHENTICATED');
    const bad = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', 'Bearer not.a.jwt')
      .expect(401);
    expect(bad.body.error.code).toBe('UNAUTHENTICATED');
    expect(bad.headers['x-request-id']).toBeDefined();
  });

  it('bootstraps the user on first authenticated request', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/me').set(auth()).expect(200);
    expect(res.body.data).toMatchObject({
      user: { id: userId, email, isAdmin: false },
      onboardingCompleted: false,
      hasProfile: false,
      hasActiveResume: false,
      profileVersion: 0,
    });
    const prefs = await request(app.getHttpServer())
      .get('/api/v1/preferences')
      .set(auth())
      .expect(200);
    expect(prefs.body.data.timezone).toBe('Asia/Kolkata');
  });

  it('rejects non-PDF/DOCX uploads by content, not extension', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/resumes')
      .set(auth())
      .attach('file', Buffer.from('<html>not a resume</html>'), 'resume.pdf')
      .expect(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('uploads and parses a PDF resume', async () => {
    const pdf = makeTextPdf([
      'Siddharth C',
      'B.E. Computer Science, XYZ Institute of Technology, Bengaluru - expected 2027',
      'Skills: Python, Java, SQL, Linux, Computer Networking, AWS, Docker, Git',
      'Projects: Network Intrusion Detector (Python, scikit-learn)',
      'Internship: IT Support Intern, ABC Solutions (Jun 2025 - Aug 2025)',
      'Certifications: AWS Cloud Practitioner (2025)',
    ]);
    const res = await request(app.getHttpServer())
      .post('/api/v1/resumes')
      .set(auth())
      .attach('file', pdf, 'My Resume.pdf');
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      parseStatus: 'PARSED',
      mimeType: 'application/pdf',
      fileName: 'My Resume.pdf',
      isActive: false,
    });
    resumeId = res.body.data.id;

    const withText = await request(app.getHttpServer())
      .get(`/api/v1/resumes/${resumeId}?includeText=true`)
      .set(auth())
      .expect(200);
    expect(withText.body.data.extractedText).toMatch(/Computer Networking/);
    const withoutText = await request(app.getHttpServer())
      .get(`/api/v1/resumes/${resumeId}`)
      .set(auth())
      .expect(200);
    expect(withoutText.body.data.extractedText).toBeUndefined();
  });

  it('re-uploading the same file returns the existing resume', async () => {
    const pdf = makeTextPdf([
      'Siddharth C',
      'B.E. Computer Science, XYZ Institute of Technology, Bengaluru - expected 2027',
      'Skills: Python, Java, SQL, Linux, Computer Networking, AWS, Docker, Git',
      'Projects: Network Intrusion Detector (Python, scikit-learn)',
      'Internship: IT Support Intern, ABC Solutions (Jun 2025 - Aug 2025)',
      'Certifications: AWS Cloud Practitioner (2025)',
    ]);
    const res = await request(app.getHttpServer())
      .post('/api/v1/resumes')
      .set(auth())
      .attach('file', pdf, 'again.pdf')
      .expect(201);
    expect(res.body.data.id).toBe(resumeId);
  });

  it('analyzes the resume into a profile draft (deterministic fallback unless AI_LIVE_TESTS=1)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/resumes/${resumeId}/analyze`)
      .set(auth())
      .expect(200);
    const { draft, deterministicFallback } = res.body.data;
    expect(deterministicFallback).toBe(!liveAi);
    expect(draft.graduationYear).toBe(2027);
    const names = draft.skills.map((s: { name: string }) => s.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'Python',
        'Java',
        'SQL',
        'Linux',
        'Networking',
        'AWS',
        'Docker',
        'Git',
      ]),
    );
    const stored = await request(app.getHttpServer())
      .get(`/api/v1/resumes/${resumeId}/analysis`)
      .set(auth())
      .expect(200);
    expect(stored.body.data.draft.graduationYear).toBe(2027);
  }, 60_000);

  it('confirms the profile, roles and preferences; onboarding completes and profile_version advances', async () => {
    const analysis = await request(app.getHttpServer())
      .get(`/api/v1/resumes/${resumeId}/analysis`)
      .set(auth())
      .expect(200);
    const draft = analysis.body.data.draft;
    const profileRes = await request(app.getHttpServer())
      .put('/api/v1/profile')
      .set(auth())
      .send({
        sourceResumeId: resumeId,
        experienceLevel: 'FRESHER',
        graduationYear: draft.graduationYear,
        degree: 'B.E.',
        branch: 'Computer Science',
        college: 'XYZ Institute of Technology',
        locationText: 'Bengaluru',
        summary: null,
        education: [],
        projects: [],
        experience: [],
        certifications: [],
        skills: [
          ...draft.skills,
          { name: 'python', category: 'LANGUAGE', proficiency: 'ADVANCED' },
        ], // duplicate collapses
      })
      .expect(200);
    const skillNames = profileRes.body.data.skills.map((s: { name: string }) => s.name);
    expect(skillNames.filter((n: string) => n.toLowerCase() === 'python')).toHaveLength(1);
    expect(profileRes.body.data.confirmedAt).toBeTruthy();

    await request(app.getHttpServer())
      .post(`/api/v1/resumes/${resumeId}/activate`)
      .set(auth())
      .expect(200);

    const roles = await request(app.getHttpServer())
      .put('/api/v1/preferred-roles')
      .set(auth())
      .send([
        { title: 'Software Engineer', tier: 'PRIMARY' },
        { title: 'Technical Support Engineer', tier: 'PRIMARY' },
        { title: 'Data Analyst', tier: 'SECONDARY' },
        { title: 'software engineer', tier: 'OTHER' }, // duplicate by normalized title
      ])
      .expect(200);
    expect(roles.body.data).toHaveLength(3);
    expect(
      roles.body.data.find((r: { title: string }) => r.title === 'Technical Support Engineer')
        .roleFamily,
    ).toBe('technical_support_engineer');

    const prefs = await request(app.getHttpServer())
      .put('/api/v1/preferences')
      .set(auth())
      .send({
        locations: ['Bengaluru', 'Remote'],
        remotePreference: 'ANY',
        employmentTypes: ['FULL_TIME', 'INTERNSHIP'],
        categories: ['SOFTWARE', 'IT_SUPPORT', 'NETWORK'],
        fresherOnly: true,
        includeUnknownExperience: true,
        salaryMin: null,
        salaryCurrency: 'inr',
        graduationYear: 2027,
        timezone: 'Asia/Kolkata',
        instantMinScore: 80,
      })
      .expect(200);
    expect(prefs.body.data.salaryCurrency).toBe('INR');

    const me = await request(app.getHttpServer()).get('/api/v1/me').set(auth()).expect(200);
    expect(me.body.data).toMatchObject({
      onboardingCompleted: true,
      hasProfile: true,
      hasActiveResume: true,
    });
    expect(me.body.data.profileVersion).toBe(3); // profile + roles + matching-relevant preference change
  }, 60_000);

  it('validates request bodies with field-level details', async () => {
    const res = await request(app.getHttpServer())
      .put('/api/v1/preferences')
      .set(auth())
      .send({ locations: 'Bengaluru' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.some((d: { path: string }) => d.path === 'locations')).toBe(true);
  });

  it('issues a short-lived signed download URL', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/resumes/${resumeId}/download`)
      .set(auth())
      .expect(200);
    // A signed Storage URL on the configured project — https in production, http on the local
    // test stack (D101). The download below proves the signature works.
    expect(
      res.body.data.url.startsWith(`${process.env.SUPABASE_URL}/storage/v1/object/sign/`),
    ).toBe(true);
    const file = await fetch(res.body.data.url);
    expect(file.status).toBe(200);
    expect(
      Buffer.from(await file.arrayBuffer())
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-');
  }, 30_000);
});
