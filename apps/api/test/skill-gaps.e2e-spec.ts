import './helpers/test-env';
import { Test } from '@nestjs/testing';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { eq, inArray } from 'drizzle-orm';
import { approvedLearningLinks } from '@jobsentinel/config';
import { normalizeCompanyName } from '@jobsentinel/validation';
import { DB, type Db } from '../src/common/db/db.module';
import { companies, jobMatches, jobs, preferences, users } from '../src/common/db/schema';
import { HTTP_CLIENT } from '../src/common/http/http.module';
import { SkillGapsService } from '../src/jobs/skill-gaps.service';
import { WorkerModule } from '../src/worker.module';
import { FakeHttpClient } from './helpers/fake-http';

/**
 * Skill-gap report (F7, D120) on a hand-built fixture: counts are right, aliases merge, and only
 * jobs the user's list would show count — never an experienced, foreign on-site, stale,
 * placeholder or held job. Links come only from the curated, approved map.
 */
const hasDb = Boolean(process.env.DATABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const describeIf = hasDb ? describe : describe.skip;

describeIf('skill gaps (F7, D120)', () => {
  const tag = `gaps-${Date.now()}`;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let db: Db;
  let admin: SupabaseClient;
  let userId: string;
  let companyId: string;

  const seed = async (
    title: string,
    score: number,
    missingSkills: string[],
    over: Partial<typeof jobs.$inferInsert> = {},
  ) => {
    const [row] = await db
      .insert(jobs)
      .values({
        companyId,
        title,
        normalizedTitle: title.toLowerCase(),
        category: 'SOFTWARE',
        sourceUrl: `https://boards.example/${tag}/${encodeURIComponent(title)}`,
        dedupeKey: `${tag}-${title}`,
        status: 'MATCHED',
        validationStatus: 'VALID',
        experienceLevel: 'FRESHER',
        experienceMinYears: '0',
        employmentType: 'FULL_TIME',
        locationCity: 'Bengaluru',
        locationCountry: 'India',
        locationText: 'Bengaluru, India',
        firstSeenAt: new Date(),
        ...over,
      })
      .returning({ id: jobs.id });
    await db.insert(jobMatches).values({
      jobId: row!.id,
      userId,
      profileVersion: 1,
      overallScore: score,
      skillScore: score,
      roleScore: score,
      experienceScore: 100,
      locationScore: 100,
      priority: score >= 90 ? 'VERY_HIGH' : score >= 75 ? 'HIGH' : 'MEDIUM',
      matchedSkills: ['Java'],
      missingSkills,
      explanation: `Match ${score}%`,
    });
    return row!.id;
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(HTTP_CLIENT)
      .useValue(new FakeHttpClient({}))
      .compile();
    db = moduleRef.get(DB);
    admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const created = await admin.auth.admin.createUser({
      email: `${tag}@jobsentinel.test`,
      password: `G-${Math.random().toString(36).slice(2)}-Pass1!`,
      email_confirm: true,
    });
    if (created.error) throw new Error(created.error.message);
    userId = created.data.user!.id;
    await db
      .insert(users)
      .values({ id: userId, email: `${tag}@jobsentinel.test`, profileVersion: 1 });
    await db.insert(preferences).values({ userId, timezone: 'Asia/Kolkata' });
    const [c] = await db
      .insert(companies)
      .values({ name: `${tag} Co`, normalizedName: normalizeCompanyName(`${tag} Co`) })
      .returning({ id: companies.id });
    companyId = c!.id;

    // Eligible: listed for this user. SQL ×3, PostgreSQL ×2 (alias "postgres"), Kubernetes ×2 ("k8s").
    await seed('Graduate Engineer Trainee', 90, ['SQL', 'postgres']);
    await seed('Associate Software Engineer', 80, ['SQL', 'k8s']);
    await seed('Software Engineer - Fresher', 70, ['PostgreSQL', 'Kubernetes', 'Communication']);
    await seed('Trainee Developer', 60, ['SQL']);
    // Not eligible — each misses "Rust", so any leak shows up in the report.
    await seed('Senior Engineer', 99, ['Rust'], {
      experienceLevel: 'EXPERIENCED',
      experienceMinYears: '4',
    });
    await seed('Graduate Engineer (US)', 98, ['Rust'], {
      locationCity: 'Austin',
      locationCountry: 'United States',
      locationText: 'Austin, TX',
    });
    await seed('Old Trainee Posting', 97, ['Rust'], {
      firstSeenAt: new Date(Date.now() - 70 * 86_400_000),
    });
    await seed('Join our Talent Community', 96, ['Rust'], { status: 'PLACEHOLDER' });
    await seed('Held Trainee', 95, ['Rust'], {
      status: 'NEEDS_REVIEW',
      holdReason: 'experience unknown',
    });
  }, 180_000);

  afterAll(async () => {
    if (companyId) {
      const ids = (
        await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.companyId, companyId))
      ).map((r) => r.id);
      if (ids.length) await db.delete(jobMatches).where(inArray(jobMatches.jobId, ids));
      await db.delete(jobs).where(eq(jobs.companyId, companyId));
      await db.delete(companies).where(eq(companies.id, companyId));
    }
    if (userId) {
      await db.delete(users).where(eq(users.id, userId));
      await admin.auth.admin.deleteUser(userId);
    }
    await moduleRef.close();
  }, 180_000);

  it('counts only the eligible top matches, with aliases merged and soft skills left out', async () => {
    const report = await moduleRef.get(SkillGapsService, { strict: false }).report(userId);
    expect(report.basedOn).toBe(4);
    expect(report.gaps.map((g) => [g.skill, g.missingIn, g.of])).toEqual([
      ['SQL', 3, 4],
      ['Kubernetes', 2, 4],
      ['PostgreSQL', 2, 4],
    ]);
    expect(report.gaps.some((g) => g.skill === 'Rust')).toBe(false);
    // Soft skills stay out of the gaps and appear only in their own note.
    expect(report.gaps.some((g) => g.skill === 'Communication')).toBe(false);
    expect(report.softSkills).toEqual([{ skill: 'Communication', missingIn: 1, of: 4 }]);
    // Best match first among the examples.
    expect(report.gaps[0]!.jobs[0]!.title).toBe('Graduate Engineer Trainee');
  });

  it('every link comes from the curated map, and only approved entries', async () => {
    const report = await moduleRef.get(SkillGapsService, { strict: false }).report(userId);
    for (const g of report.gaps) {
      expect(g.links).toEqual(
        approvedLearningLinks(g.skill).map(({ title, url, publisher }) => ({
          title,
          url,
          publisher,
        })),
      );
    }
  });

  it('a user with no matches gets an empty report, not an error', async () => {
    const report = await moduleRef
      .get(SkillGapsService, { strict: false })
      .report('00000000-0000-4000-8000-0000000000aa');
    expect(report).toMatchObject({ basedOn: 0, gaps: [] });
  });
});
