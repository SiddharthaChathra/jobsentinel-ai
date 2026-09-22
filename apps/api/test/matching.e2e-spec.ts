import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { and, eq, inArray } from 'drizzle-orm';
import type { AIRequest, AIResult, AIService } from '@jobsentinel/ai';
import { normalizeCompanyName } from '@jobsentinel/validation';
import { AI_SERVICE } from '../src/common/ai/ai.module';
import { DB, type Db } from '../src/common/db/db.module';
import {
  companies,
  jobMatches,
  jobs,
  preferences,
  preferredRoles,
  profileSkills,
  profiles,
  skills,
  users,
} from '../src/common/db/schema';
import { HTTP_CLIENT } from '../src/common/http/http.module';
import { MatchingService } from '../src/matching/matching.service';
import { WorkerModule } from '../src/worker.module';
import { FakeHttpClient } from './helpers/fake-http';

/**
 * Matching stage against the live DB (docs 09 §5): the deterministic score is always stored,
 * the AI refines only plausible jobs and only within ±25, and a low score never drops a job.
 * Every run is scoped to this spec's user and jobs so the shared project's real data is untouched.
 */
const hasDb = Boolean(process.env.DATABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const describeIf = hasDb ? describe : describe.skip;

class FakeAi {
  readonly calls: AIRequest<unknown>[] = [];
  constructor(private readonly responses: Record<string, unknown> = {}) {}
  get primaryProvider() {
    return { name: 'fake', model: 'fake-1' };
  }
  run<T>(req: AIRequest<T>): Promise<AIResult<T>> {
    this.calls.push(req as AIRequest<unknown>);
    const data = this.responses[req.purpose];
    if (!data) return Promise.resolve({ status: 'ERROR', error: 'no scripted response' });
    return Promise.resolve({
      status: 'OK',
      data: data as T,
      provider: 'fake',
      model: 'fake-1',
      usage: { inputTokens: 1, outputTokens: 1 },
      latencyMs: 1,
      cached: false,
    });
  }
}

describeIf('matching stage (integration)', () => {
  const tag = `match-${Date.now()}`;
  let db: Db;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let service: MatchingService;
  let fakeAi: FakeAi;
  let admin: SupabaseClient;
  let userId: string;
  let companyId: string;
  let perfectId: string;
  let wrongRoleId: string;

  const build = async (responses?: Record<string, unknown>) => {
    fakeAi = new FakeAi(responses);
    moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(HTTP_CLIENT)
      .useValue(new FakeHttpClient({}))
      .overrideProvider(AI_SERVICE)
      .useValue(fakeAi as unknown as AIService)
      .compile();
    db = moduleRef.get(DB);
    service = moduleRef.get(MatchingService);
  };

  const seedJob = async (title: string, over: Partial<typeof jobs.$inferInsert> = {}) => {
    const [row] = await db
      .insert(jobs)
      .values({
        companyId,
        title,
        normalizedTitle: title.toLowerCase(),
        roleFamily: 'software_engineer',
        category: 'SOFTWARE',
        description: 'Build and ship backend services.',
        skills: ['Python', 'SQL'],
        experienceLevel: 'FRESHER',
        fresherEligible: true,
        locationCity: 'Bengaluru',
        locationCountry: 'India',
        sourceUrl: `https://boards.example/${tag}/${encodeURIComponent(title)}`,
        dedupeKey: `${tag}-${title}`,
        status: 'VALID',
        firstSeenAt: new Date('2020-01-01T00:00:00Z'),
        ...over,
      })
      .returning({ id: jobs.id });
    return row!.id;
  };

  /** Always scoped: never pull the project's real jobs into this throwaway user's match set. */
  const run = (jobIds: string[], opts: { maxAiCalls?: number } = {}) =>
    service.matchPending({
      batch: 50,
      maxAiCalls: opts.maxAiCalls ?? 0,
      userIds: [userId],
      jobIds,
    });

  const matchOf = async (jobId: string) =>
    (await db.query.jobMatches.findFirst({
      where: and(eq(jobMatches.jobId, jobId), eq(jobMatches.userId, userId)),
      orderBy: (m, { desc }) => [desc(m.profileVersion)],
    }))!;

  beforeAll(async () => {
    await build();
    admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const created = await admin.auth.admin.createUser({
      email: `${tag}@jobsentinel.test`,
      password: `M-${Math.random().toString(36).slice(2)}-Pass1!`,
      email_confirm: true,
    });
    if (created.error) throw new Error(created.error.message);
    userId = created.data.user!.id;

    await db
      .insert(users)
      .values({ id: userId, email: `${tag}@jobsentinel.test`, profileVersion: 1 });
    const [profile] = await db
      .insert(profiles)
      .values({
        userId,
        experienceLevel: 'FRESHER',
        graduationYear: 2027,
        summary: 'Final-year CS student',
      })
      .returning({ id: profiles.id });
    await db.insert(preferences).values({
      userId,
      locations: ['Bengaluru', 'Remote'],
      categories: ['SOFTWARE', 'IT_SUPPORT'],
      fresherOnly: true,
      remotePreference: 'ANY',
      graduationYear: 2027,
    });
    await db.insert(preferredRoles).values([
      {
        userId,
        title: 'Software Engineer',
        normalizedTitle: 'software engineer',
        roleFamily: 'software_engineer',
        tier: 'PRIMARY',
      },
      {
        userId,
        title: 'Technical Support Engineer',
        normalizedTitle: 'technical support engineer',
        roleFamily: 'technical_support_engineer',
        tier: 'SECONDARY',
      },
    ]);
    for (const name of ['Python', 'SQL', 'Linux', 'AWS']) {
      const [s] = await db
        .insert(skills)
        .values({ name, normalizedName: name.toLowerCase(), category: 'LANGUAGE' })
        .onConflictDoUpdate({ target: skills.normalizedName, set: { updatedAt: new Date() } })
        .returning({ id: skills.id });
      await db
        .insert(profileSkills)
        .values({ profileId: profile!.id, skillId: s!.id, origin: 'USER' })
        .onConflictDoNothing();
    }

    const [c] = await db
      .insert(companies)
      .values({ name: `${tag} Co`, normalizedName: normalizeCompanyName(`${tag} Co`) })
      .returning({ id: companies.id });
    companyId = c!.id;

    perfectId = await seedJob('Software Engineer');
    wrongRoleId = await seedJob('Mechanical Design Engineer', {
      roleFamily: 'mechanical_engineer',
      category: 'MECHANICAL',
      skills: ['AutoCAD'],
    });
  }, 120_000);

  afterAll(async () => {
    if (companyId) {
      await db.delete(jobs).where(eq(jobs.companyId, companyId));
      await db.delete(companies).where(inArray(companies.id, [companyId]));
    }
    if (userId) {
      await db.delete(users).where(eq(users.id, userId));
      await admin.auth.admin.deleteUser(userId);
    }
    await moduleRef.close();
  }, 120_000);

  it('scores matchable jobs deterministically and marks VALID jobs MATCHED', async () => {
    const result = await run([perfectId, wrongRoleId]);
    expect(result).toMatchObject({ candidates: 2, scored: 2, aiUsed: 0 });
    expect(fakeAi.calls).toHaveLength(0);

    // skills 100 · role 100 (PRIMARY) · experience 100 (FRESHER) · location 100 (Bengaluru)
    const good = await matchOf(perfectId);
    expect(good).toMatchObject({
      overallScore: 100,
      skillScore: 100,
      roleScore: 100,
      priority: 'VERY_HIGH',
      profileVersion: 1,
    });
    expect(good.matchedSkills).toEqual(['Python', 'SQL']);
    expect(good.explanation).toContain('Match 100% — ✓ Python ✓ SQL');
    expect((await db.query.jobs.findFirst({ where: eq(jobs.id, perfectId) }))!.status).toBe(
      'MATCHED',
    );

    // A poor match is still scored and kept — a score never rejects a job (spec principle 9).
    // skills 0 · role 10 (category not wanted) · experience 100 · location 100 → 33
    const poor = await matchOf(wrongRoleId);
    expect(poor).toMatchObject({ overallScore: 33, priority: 'OTHER' });
    expect(poor.missingSkills).toEqual(['AutoCAD']);
  }, 120_000);

  it('does not rescore a job for the same profile version', async () => {
    const result = await run([perfectId, wrongRoleId]);
    expect(result).toMatchObject({ candidates: 0, scored: 0 });
  }, 60_000);

  it('rescores everything when the profile version changes, keeping the old rows', async () => {
    await db.update(users).set({ profileVersion: 2 }).where(eq(users.id, userId));
    const result = await run([perfectId, wrongRoleId]);
    expect(result.scored).toBe(2);
    const rows = await db.select().from(jobMatches).where(eq(jobMatches.userId, userId));
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.profileVersion))).toEqual(new Set([1, 2]));
  }, 120_000);

  it('uses the AI only for plausible jobs and caps how far it can move a score', async () => {
    await moduleRef.close();
    await build({
      JOB_REQUIREMENTS: {
        mustHaveSkills: ['Python', 'Kubernetes'],
        niceToHaveSkills: ['SQL'],
        minYears: 0,
        maxYears: 1,
        educationRequired: null,
        isFresherFriendly: 'YES',
        responsibilities: ['Build APIs'],
      },
      MATCH: {
        skillScore: 100,
        roleScore: 100,
        matchedSkills: ['Python', 'SQL'],
        missingSkills: ['Kubernetes'],
        explanation: 'Strong Python and SQL overlap; Kubernetes is missing.',
      },
    });
    await db.update(users).set({ profileVersion: 3 }).where(eq(users.id, userId));
    const plausibleId = await seedJob('Backend Engineer', { skills: ['Python', 'Kubernetes'] });
    const hopelessId = await seedJob('Civil Site Engineer', {
      roleFamily: 'civil_engineer',
      category: 'CIVIL',
      skills: ['AutoCAD'],
      locationCity: 'Berlin',
      locationCountry: 'Germany',
      experienceLevel: 'EXPERIENCED',
      fresherEligible: false,
    });

    const result = await service.matchPending({
      batch: 50,
      maxAiCalls: 5,
      userIds: [userId],
      jobIds: [perfectId, wrongRoleId, plausibleId, hopelessId],
    });
    expect(result.scored).toBe(4);

    // Only the two jobs scoring ≥ 35 deterministically were worth an AI call.
    expect(result.aiUsed).toBe(2);
    expect(fakeAi.calls.filter((c) => c.purpose === 'MATCH')).toHaveLength(2);

    // Requirements give a baseline of 1 of 2 must-haves + the nice-to-have = 1.4/2.4 → 58.
    // The AI claims 100; ±25 bounding lands it on 83, not 100.
    const refined = await matchOf(plausibleId);
    expect(refined.skillScore).toBe(83);
    expect(refined.explanation).toBe('Strong Python and SQL overlap; Kubernetes is missing.');
    expect(refined).toMatchObject({
      aiProvider: 'fake',
      aiModel: 'fake-1',
      promptVersion: 'match.v1',
    });

    // The hopeless job was scored deterministically but never sent to the AI.
    // skills 0 · role 10 · experience 0 (EXPERIENCED, fresherOnly) · location 25 → 6
    const skipped = await matchOf(hopelessId);
    expect(skipped).toMatchObject({ overallScore: 6, priority: 'OTHER', aiProvider: null });
  }, 120_000);

  it('falls back to the deterministic score when the AI is unavailable', async () => {
    await moduleRef.close();
    await build({}); // every AI call errors
    await db.update(users).set({ profileVersion: 4 }).where(eq(users.id, userId));
    const id = await seedJob('Platform Engineer');

    const result = await service.matchPending({
      batch: 50,
      maxAiCalls: 5,
      userIds: [userId],
      jobIds: [id],
    });
    expect(result).toMatchObject({ scored: 1, aiUsed: 0, aiUnavailable: 1 });

    const row = await matchOf(id);
    expect(row).toMatchObject({
      overallScore: 100,
      priority: 'VERY_HIGH',
      aiProvider: null,
      promptVersion: null,
    });
  }, 120_000);
});
