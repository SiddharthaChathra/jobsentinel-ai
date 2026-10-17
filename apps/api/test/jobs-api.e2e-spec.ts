import './helpers/test-env';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { eq, inArray } from 'drizzle-orm';
import type { ApplicationItem, DashboardSummary, JobCard, JobDetail } from '@jobsentinel/types';
import { normalizeCompanyName } from '@jobsentinel/validation';
import { AppModule } from '../src/app.module';
import { DB, type Db } from '../src/common/db/db.module';
import {
  applications,
  companies,
  jobMatches,
  jobs,
  jobSourceMappings,
  jobSources,
  preferences,
  savedJobs,
  users,
} from '../src/common/db/schema';
import { HTTP_CLIENT } from '../src/common/http/http.module';
import { FakeHttpClient } from './helpers/fake-http';

/**
 * Jobs / tracker / dashboard API against the live database (docs 03 §3–§5).
 * Every request is made as a real Supabase user with a real JWT, so the auth guard, the Zod
 * query pipe and the response envelope are all exercised.
 */
const hasDb = Boolean(process.env.DATABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const describeIf = hasDb ? describe : describe.skip;

describeIf('jobs API (integration)', () => {
  const tag = `jobsapi-${Date.now()}`;
  let app: INestApplication;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let db: Db;
  let admin: SupabaseClient;
  let token: string;
  let userId: string;
  let companyId: string;
  let freshId: string;
  let olderId: string;
  let remoteId: string;
  const password = `J-${Math.random().toString(36).slice(2)}-Pass1!`;
  const email = `${tag}@jobsentinel.test`;

  const api = () => request(app.getHttpServer() as Parameters<typeof request>[0]);
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  const seedJob = async (title: string, over: Partial<typeof jobs.$inferInsert> = {}) => {
    const [row] = await db
      .insert(jobs)
      .values({
        companyId,
        title,
        normalizedTitle: title.toLowerCase(),
        roleFamily: 'software_engineer',
        category: 'SOFTWARE',
        description: `${title} building distributed systems with Python.`,
        skills: ['Python', 'SQL'],
        experienceLevel: 'FRESHER',
        fresherEligible: true,
        locationCity: 'Bengaluru',
        locationCountry: 'India',
        sourceUrl: `https://boards.example/${tag}/${encodeURIComponent(title)}`,
        applicationUrl: `https://boards.example/${tag}/${encodeURIComponent(title)}/apply`,
        dedupeKey: `${tag}-${title}`,
        status: 'VALID',
        validationStatus: 'VALID',
        validationConfidence: '0.94',
        ...over,
      })
      .returning({ id: jobs.id });
    return row!.id;
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(HTTP_CLIENT)
      .useValue(new FakeHttpClient({}))
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });
    await app.init();
    db = moduleRef.get(DB);

    admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw new Error(created.error.message);
    userId = created.data.user!.id;
    const signIn = await createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
    ).auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(signIn.error.message);
    token = signIn.data.session!.access_token;

    await db.insert(users).values({ id: userId, email, profileVersion: 1 });
    // The list is scoped to the user's preferred locations by default (D62), so the suite needs
    // a preferences row to exercise that at all.
    await db.insert(preferences).values({ userId, locations: ['Bengaluru', 'India'] });
    const [c] = await db
      .insert(companies)
      .values({
        name: `${tag} Co`,
        normalizedName: normalizeCompanyName(`${tag} Co`),
        verificationStatus: 'VERIFIED',
      })
      .returning({ id: companies.id });
    companyId = c!.id;

    // Relative, not absolute: the list carries a hard 60-day recency ceiling (D73), so fixtures
    // dated 2020 would simply not be listed. The ordering they exist to test is preserved.
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
    freshId = await seedJob('Graduate Software Engineer');
    olderId = await seedJob('Associate Backend Engineer', {
      firstSeenAt: daysAgo(10),
    });
    remoteId = await seedJob('Remote Platform Engineer', {
      isRemote: true,
      locationCity: null,
      locationCountry: null,
      firstSeenAt: daysAgo(20),
    });
    // A job the user must not see by default: unconfirmed validation.
    await seedJob('Unverified Listing', {
      status: 'NEEDS_REVIEW',
      validationStatus: 'NEEDS_REVIEW',
    });

    await db.insert(jobMatches).values([
      {
        jobId: freshId,
        userId,
        profileVersion: 1,
        overallScore: 92,
        skillScore: 90,
        roleScore: 100,
        experienceScore: 100,
        locationScore: 100,
        priority: 'VERY_HIGH',
        matchedSkills: ['Python', 'SQL'],
        missingSkills: [],
        explanation: 'Match 92% — ✓ Python ✓ SQL',
      },
      {
        jobId: olderId,
        userId,
        profileVersion: 1,
        overallScore: 64,
        skillScore: 50,
        roleScore: 80,
        experienceScore: 100,
        locationScore: 100,
        priority: 'MEDIUM',
        matchedSkills: ['Python'],
        missingSkills: ['Go'],
        explanation: 'Match 64%',
      },
      // Deliberately stale: scored against an older resume, so it must never be shown.
      {
        jobId: remoteId,
        userId,
        profileVersion: 0,
        overallScore: 99,
        skillScore: 99,
        roleScore: 99,
        experienceScore: 99,
        locationScore: 99,
        priority: 'VERY_HIGH',
        matchedSkills: ['Stale'],
        missingSkills: [],
        explanation: 'from a previous profile version',
      },
    ]);
  }, 180_000);

  afterAll(async () => {
    if (userId) {
      // saved_jobs and applications reference jobs ON DELETE RESTRICT.
      await db.delete(applications).where(eq(applications.userId, userId));
      await db.delete(savedJobs).where(eq(savedJobs.userId, userId));
    }
    if (companyId) {
      await db.delete(jobs).where(eq(jobs.companyId, companyId));
      await db.delete(companies).where(inArray(companies.id, [companyId]));
    }
    if (userId) {
      await db.delete(users).where(eq(users.id, userId));
      await admin.auth.admin.deleteUser(userId);
    }
    await app.close();
  }, 180_000);

  it('rejects an unauthenticated request', async () => {
    await api().get('/api/v1/jobs').expect(401);
  });

  it('lists only confirmed jobs, newest first, with the user match attached', async () => {
    const res = await auth(api().get(`/api/v1/jobs?companyId=${companyId}`)).expect(200);
    const body = res.body as { data: JobCard[]; meta: { nextCursor: string | null } };

    const titles = body.data.map((j) => j.title);
    expect(titles).toContain('Graduate Software Engineer');
    expect(titles).not.toContain('Unverified Listing'); // NEEDS_REVIEW is opt-in
    expect(titles.indexOf('Graduate Software Engineer')).toBeLessThan(
      titles.indexOf('Associate Backend Engineer'),
    );

    const fresh = body.data.find((j) => j.id === freshId)!;
    expect(fresh.match).toMatchObject({ overallScore: 92, priority: 'VERY_HIGH' });
    expect(fresh.company).toMatchObject({ name: `${tag} Co`, verificationStatus: 'VERIFIED' });
    expect(fresh.tracker).toEqual({ saved: false, status: null });
    expect(fresh.applicationUrl).toContain('/apply');
    expect(fresh.validation).toMatchObject({ status: 'VALID', confidence: 0.94, jobActive: true });
  }, 60_000);

  it('never shows a score computed for a different profile version', async () => {
    const res = await auth(api().get(`/api/v1/jobs?companyId=${companyId}&limit=50`)).expect(200);
    const remote = (res.body as { data: JobCard[] }).data.find((j) => j.id === remoteId)!;
    expect(remote.match).toBeNull(); // the 99 belongs to profileVersion 0
  }, 60_000);

  it('opts in to unconfirmed jobs only when asked', async () => {
    const res = await auth(
      api().get(`/api/v1/jobs?companyId=${companyId}&validationStatus=VALID,NEEDS_REVIEW`),
    ).expect(200);
    const titles = (res.body as { data: JobCard[] }).data.map((j) => j.title);
    expect(titles).toContain('Unverified Listing');
  }, 60_000);

  it('filters and sorts', async () => {
    const remote = await auth(api().get(`/api/v1/jobs?companyId=${companyId}&remote=true`)).expect(
      200,
    );
    expect((remote.body as { data: JobCard[] }).data.map((j) => j.id)).toEqual([remoteId]);

    const byScore = await auth(
      api().get(`/api/v1/jobs?companyId=${companyId}&sort=score&minScore=60`),
    ).expect(200);
    const scored = (byScore.body as { data: JobCard[] }).data;
    expect(scored.map((j) => j.id)).toEqual([freshId, olderId]);

    const searched = await auth(
      api().get(`/api/v1/jobs?companyId=${companyId}&q=distributed`),
    ).expect(200);
    expect((searched.body as { data: JobCard[] }).data.length).toBeGreaterThan(0);
  }, 60_000);

  it('pages with a stable cursor', async () => {
    const first = await auth(api().get(`/api/v1/jobs?companyId=${companyId}&limit=1`)).expect(200);
    const firstBody = first.body as { data: JobCard[]; meta: { nextCursor: string | null } };
    expect(firstBody.data).toHaveLength(1);
    expect(firstBody.meta.nextCursor).toBeTruthy();

    const second = await auth(
      api().get(
        `/api/v1/jobs?companyId=${companyId}&limit=1&cursor=${encodeURIComponent(firstBody.meta.nextCursor!)}`,
      ),
    ).expect(200);
    const secondBody = second.body as { data: JobCard[] };
    expect(secondBody.data).toHaveLength(1);
    expect(secondBody.data[0]!.id).not.toBe(firstBody.data[0]!.id);
  }, 60_000);

  it('rejects an invalid query instead of ignoring it', async () => {
    await auth(api().get('/api/v1/jobs?minScore=500')).expect(400);
    await auth(api().get('/api/v1/jobs?sort=sideways')).expect(400);
  }, 60_000);

  it('returns the full detail with evidence, score breakdown and sources', async () => {
    const res = await auth(api().get(`/api/v1/jobs/${freshId}`)).expect(200);
    const detail = (res.body as { data: JobDetail }).data;
    expect(detail.id).toBe(freshId);
    expect(detail.description).toContain('distributed systems');
    expect(detail.skills).toEqual(['Python', 'SQL']);
    expect(detail.match).toMatchObject({
      overallScore: 92,
      skillScore: 90,
      roleScore: 100,
      missingSkills: [],
      aiPending: true, // scored above the pre-filter but with no AI verdict yet
    });
    expect(detail.validationDetail).toMatchObject({ status: 'VALID' });
    expect(Array.isArray(detail.events)).toBe(true);
  }, 60_000);

  it('404s an unknown job rather than leaking an empty shell', async () => {
    await auth(api().get('/api/v1/jobs/00000000-0000-4000-8000-000000000000')).expect(404);
  }, 60_000);

  it('saves, unsaves and lists saved jobs', async () => {
    const saved = await auth(api().post(`/api/v1/jobs/${freshId}/save`)).expect(200);
    expect((saved.body as { data: { saved: boolean } }).data.saved).toBe(true);

    // Saving twice is not an error.
    await auth(api().post(`/api/v1/jobs/${freshId}/save`)).expect(200);

    const list = await auth(api().get('/api/v1/saved-jobs')).expect(200);
    expect((list.body as { data: JobCard[] }).data.map((j) => j.id)).toEqual([freshId]);

    const card = (list.body as { data: JobCard[] }).data[0]!;
    expect(card.tracker.saved).toBe(true);

    await auth(api().delete(`/api/v1/jobs/${freshId}/save`)).expect(200);
    const after = await auth(api().get('/api/v1/saved-jobs')).expect(200);
    expect((after.body as { data: JobCard[] }).data).toHaveLength(0);
  }, 60_000);

  it('tracks an application through its statuses and keeps the history', async () => {
    await auth(api().post(`/api/v1/jobs/${olderId}/view`)).expect(200);

    const applied = await auth(api().put(`/api/v1/applications/${olderId}`))
      .send({ status: 'APPLIED', notes: 'Referred by a senior' })
      .expect(200);
    const item = (applied.body as { data: ApplicationItem }).data;
    expect(item.status).toBe('APPLIED');
    expect(item.appliedAt).not.toBeNull(); // defaulted for APPLIED
    expect(item.job.id).toBe(olderId);

    const interview = await auth(api().put(`/api/v1/applications/${olderId}`))
      .send({ status: 'INTERVIEW' })
      .expect(200);
    const updated = (interview.body as { data: ApplicationItem }).data;
    expect(updated.status).toBe('INTERVIEW');
    expect(updated.appliedAt).toBe(item.appliedAt); // the applied date survives later changes
    expect(updated.history.map((h) => h.status)).toEqual(['VIEWED', 'APPLIED', 'INTERVIEW']);

    const list = await auth(api().get('/api/v1/applications?status=INTERVIEW')).expect(200);
    expect((list.body as { data: ApplicationItem[] }).data.map((a) => a.job.id)).toEqual([olderId]);

    await auth(api().delete(`/api/v1/applications/${olderId}`)).expect(204);
    const empty = await auth(api().get('/api/v1/applications?status=INTERVIEW')).expect(200);
    expect((empty.body as { data: ApplicationItem[] }).data).toHaveLength(0);
  }, 60_000);

  it('marks a job not interested without deleting it', async () => {
    await auth(api().post(`/api/v1/jobs/${remoteId}/not-interested`))
      .send({ reason: 'Wrong stack' })
      .expect(200);

    const still = await db.query.jobs.findFirst({ where: eq(jobs.id, remoteId) });
    expect(still).toBeDefined(); // the posting itself is untouched (spec principle 9)

    const res = await auth(
      api().get(`/api/v1/jobs?companyId=${companyId}&tracker=NOT_INTERESTED`),
    ).expect(200);
    expect((res.body as { data: JobCard[] }).data.map((j) => j.id)).toEqual([remoteId]);
  }, 60_000);

  it('scopes the list to the preferred locations, and lifts it on request (D62)', async () => {
    const abroadId = await seedJob('Berlin Backend Engineer', {
      locationCity: 'Berlin',
      locationCountry: 'Germany',
      locationText: 'Berlin, Germany',
    });

    const scoped = await auth(api().get(`/api/v1/jobs?companyId=${companyId}&limit=50`)).expect(
      200,
    );
    const scopedIds = (scoped.body as { data: JobCard[] }).data.map((j) => j.id);
    expect(scopedIds).not.toContain(abroadId); // outside Bengaluru / India
    expect(scopedIds).toContain(remoteId); // remote is always in scope

    const all = await auth(
      api().get(`/api/v1/jobs?companyId=${companyId}&limit=50&anywhere=true`),
    ).expect(200);
    expect((all.body as { data: JobCard[] }).data.map((j) => j.id)).toContain(abroadId);
  }, 60_000);

  it('never lists a posting older than 60 days, however wide the filter (D73)', async () => {
    const ancientId = await seedJob('Ancient Graduate Engineer', {
      firstSeenAt: new Date(Date.now() - 200 * 86_400_000),
      postedAt: new Date(Date.now() - 200 * 86_400_000),
    });

    const wide = await auth(
      api().get(
        // Explicitly asking for two years of history must not reopen the ceiling: a posting that
        // old is filled, and showing it costs the user a wasted application.
        `/api/v1/jobs?companyId=${companyId}&limit=50&anywhere=true&postedAfter=${new Date(Date.now() - 730 * 86_400_000).toISOString()}`,
      ),
    ).expect(200);
    expect((wide.body as { data: JobCard[] }).data.map((j) => j.id)).not.toContain(ancientId);

    // …but the job itself is kept, never deleted (docs 02 §8).
    const still = await db.query.jobs.findFirst({ where: eq(jobs.id, ancientId) });
    expect(still).toBeDefined();
  }, 60_000);

  it('summarises the dashboard', async () => {
    const res = await auth(api().get('/api/v1/dashboard/summary')).expect(200);
    const summary = (res.body as { data: DashboardSummary }).data;
    expect(summary.byPriority.veryHigh).toBeGreaterThanOrEqual(1);
    expect(summary.newThisWeek).toBeGreaterThanOrEqual(1);
    expect(summary.topMatches.length).toBeGreaterThan(0);
    expect(summary.topMatches[0]!.match!.overallScore).toBeGreaterThanOrEqual(
      summary.topMatches[summary.topMatches.length - 1]!.match!.overallScore,
    );
    expect(summary.system).toHaveProperty('workerAlive');
  }, 60_000);
  // Last in the file: it adds jobs to the suite's company, which earlier tests count exactly.
  it('lists any remote job, whatever country it names, but not an on-site job abroad (D102)', async () => {
    const remoteAbroad = await seedJob('Zephyrine Remote Developer', {
      isRemote: true,
      locationCity: null,
      locationCountry: 'United States',
      locationText: 'Remote - United States',
    });
    const onsiteAbroad = await seedJob('Zephyrine Onsite Developer', {
      locationCity: 'Austin',
      locationCountry: 'United States',
      locationText: 'Austin, TX',
    });
    // Default list: scoped to the user's places (Bengaluru, India) — remote passes, on-site abroad not.
    const res = await auth(api().get(`/api/v1/jobs?companyId=${companyId}&q=Zephyrine`)).expect(
      200,
    );
    const ids = (res.body as { data: JobCard[] }).data.map((j) => j.id);
    expect(ids).toContain(remoteAbroad);
    expect(ids).not.toContain(onsiteAbroad);
  }, 60_000);

  it('shows and filters by posting type (F3, D114)', async () => {
    const drive = await seedJob('Ondrel Campus Developer', { postingType: 'CAMPUS_DRIVE' });
    const programme = await seedJob('Ondrel Programme Developer', {
      postingType: 'OFF_CAMPUS_PROGRAM',
    });
    const regular = await seedJob('Ondrel Regular Developer');
    const res = await auth(
      api().get(
        `/api/v1/jobs?companyId=${companyId}&q=Ondrel&postingType=CAMPUS_DRIVE,OFF_CAMPUS_PROGRAM`,
      ),
    ).expect(200);
    const cards = (res.body as { data: JobCard[] }).data;
    expect(cards.map((c) => c.id).sort()).toEqual([drive, programme].sort());
    expect(cards.find((c) => c.id === drive)?.postingType).toBe('CAMPUS_DRIVE');
    const all = await auth(api().get(`/api/v1/jobs?companyId=${companyId}&q=Ondrel`)).expect(200);
    expect((all.body as { data: JobCard[] }).data.find((c) => c.id === regular)?.postingType).toBe(
      'REGULAR',
    );
  }, 60_000);

  it("credits Adzuna on a job whose displayed content is Adzuna's, and only there (D115)", async () => {
    const [adzuna] = await db
      .insert(jobSources)
      .values({
        name: `${tag} Adzuna`,
        type: 'PUBLIC_API',
        adapter: 'adzuna',
        config: { country: 'in' },
      })
      .returning({ id: jobSources.id });
    try {
      const fromAdzuna = await seedJob('Brivane Adzuna Developer');
      const fromBoard = await seedJob('Brivane Board Developer');
      await db.insert(jobSourceMappings).values({
        jobId: fromAdzuna,
        sourceId: adzuna!.id,
        externalId: `${tag}-adz-1`,
        sourceUrl: 'https://www.adzuna.in/details/1',
        isPrimary: true,
      });
      const res = await auth(api().get(`/api/v1/jobs?companyId=${companyId}&q=Brivane`)).expect(
        200,
      );
      const cards = (res.body as { data: JobCard[] }).data;
      expect(cards.find((c) => c.id === fromAdzuna)?.attribution).toEqual({
        provider: 'ADZUNA',
        label: 'Adzuna',
        url: 'https://www.adzuna.in/',
      });
      expect(cards.find((c) => c.id === fromBoard)?.attribution).toBeNull();
      const detail = await auth(api().get(`/api/v1/jobs/${fromAdzuna}`)).expect(200);
      expect((detail.body as { data: JobDetail }).data.attribution?.label).toBe('Adzuna');
    } finally {
      await db.delete(jobSources).where(eq(jobSources.id, adzuna!.id));
    }
  }, 60_000);

  it('keeps undisclosed salaries under a salary filter unless asked not to (R6, D111)', async () => {
    const paid = await seedJob('Quillfeather Paid Developer', {
      salaryMin: '600000',
      salaryMax: '800000',
      salaryDisclosed: true,
      salaryText: '₹6-8 LPA',
    });
    const low = await seedJob('Quillfeather Low Developer', {
      salaryMin: '200000',
      salaryDisclosed: true,
      salaryText: '₹2 LPA',
    });
    const hidden = await seedJob('Quillfeather Hidden Developer'); // no salary stated
    const list = async (extra: string) => {
      const res = await auth(
        api().get(`/api/v1/jobs?companyId=${companyId}&q=Quillfeather&salaryMin=500000${extra}`),
      ).expect(200);
      return (res.body as { data: JobCard[] }).data.map((j) => j.id).sort();
    };
    // Default ON: the stated minimum must meet it; "Not disclosed" is kept.
    expect(await list('')).toEqual([paid, hidden].sort());
    expect(await list('&includeUndisclosedSalary=true')).toEqual([paid, hidden].sort());
    // OFF: only jobs whose stated minimum meets the filter.
    expect(await list('&includeUndisclosedSalary=false')).toEqual([paid]);
    expect(await list('&includeUndisclosedSalary=false')).not.toContain(low);
  }, 60_000);
});
