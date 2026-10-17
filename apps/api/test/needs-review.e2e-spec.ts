import './helpers/test-env';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { eq, inArray } from 'drizzle-orm';
import type { JobCard, ReviewJobCard } from '@jobsentinel/types';
import { normalizeCompanyName } from '@jobsentinel/validation';
import { AppModule } from '../src/app.module';
import { DB, type Db } from '../src/common/db/db.module';
import {
  companies,
  jobEvents,
  jobMatches,
  jobs,
  jobValidation,
  notifications,
  notificationSettings,
  preferences,
  users,
} from '../src/common/db/schema';
import { HTTP_CLIENT } from '../src/common/http/http.module';
import { DigestService } from '../src/notifications/digest.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { FakeHttpClient } from './helpers/fake-http';

/**
 * The Needs review view (C step 2, D106): held jobs, each with why it is held; every list gate
 * still applies; never in the main list; never sent to Telegram (instant or digest).
 */
const hasDb = Boolean(process.env.DATABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const describeIf = hasDb ? describe : describe.skip;

describeIf('Needs review view (C step 2, D106)', () => {
  const tag = `review-${Date.now()}`;
  let app: INestApplication;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let db: Db;
  let supa: SupabaseClient;
  let token: string;
  let userId: string;
  let companyId: string;
  const ids: Record<string, string> = {};
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
  const api = () => request(app.getHttpServer() as Parameters<typeof request>[0]);

  const seed = async (key: string, over: Partial<typeof jobs.$inferInsert> = {}) => {
    const title = `${tag} ${key}`;
    const [row] = await db
      .insert(jobs)
      .values({
        companyId,
        title,
        normalizedTitle: title.toLowerCase(),
        roleFamily: 'software_engineer',
        category: 'SOFTWARE',
        description: 'Graduate engineer trainee. Freshers welcome.',
        experienceLevel: 'FRESHER',
        experienceMinYears: '0',
        fresherEligible: true,
        locationCity: 'Pune',
        locationCountry: 'India',
        sourceUrl: `https://boards.example/${tag}/${key}`,
        applicationUrl: `https://boards.example/${tag}/${key}/apply`,
        dedupeKey: `${tag}-${key}`,
        status: 'NEEDS_REVIEW',
        validationStatus: 'PENDING',
        firstSeenAt: daysAgo(2),
        ...over,
      })
      .returning({ id: jobs.id });
    ids[key] = row!.id;
    await db.insert(jobMatches).values({
      jobId: row!.id,
      userId,
      profileVersion: 1,
      overallScore: 90,
      skillScore: 90,
      roleScore: 90,
      experienceScore: 90,
      locationScore: 90,
      priority: 'VERY_HIGH',
      matchedSkills: [],
      missingSkills: [],
    });
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
    supa = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const email = `${tag}@jobsentinel.test`;
    const password = `R-${Math.random().toString(36).slice(2)}-Pass1!`;
    const created = await supa.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw new Error(created.error.message);
    userId = created.data.user!.id;
    await db.insert(users).values({ id: userId, email, profileVersion: 1 });
    await db.insert(preferences).values({ userId, locations: ['India'], categories: ['SOFTWARE'] });
    // The setting that used to put held jobs in the Telegram digest — on, to prove it no longer does.
    await db
      .insert(notificationSettings)
      .values({ userId, includeNeedsReviewInDigest: true, telegramEnabled: true })
      .onConflictDoUpdate({
        target: notificationSettings.userId,
        set: { includeNeedsReviewInDigest: true, telegramEnabled: true },
      });
    const signIn = await createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
    ).auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(signIn.error.message);
    token = signIn.data.session!.access_token;
    const [c] = await db
      .insert(companies)
      .values({ name: `${tag} Co`, normalizedName: normalizeCompanyName(`${tag} Co`) })
      .returning({ id: companies.id });
    companyId = c!.id;

    // Held at classification: category unknown (D105).
    await seed('category-held', { category: 'UNKNOWN' });
    await db.insert(jobEvents).values({
      jobId: ids['category-held']!,
      type: 'HELD',
      detail: { reason: 'category unknown' },
    });
    // Held by verification: an Adzuna link, so the company cannot be confirmed (C step 1).
    await seed('company-held', { validationStatus: 'NEEDS_REVIEW' });
    await db.insert(jobValidation).values({
      jobId: ids['company-held']!,
      status: 'NEEDS_REVIEW',
      finalUrl: 'https://www.adzuna.in/details/5925494591',
    });
    await db.insert(jobEvents).values({
      jobId: ids['company-held']!,
      type: 'VALIDATED',
      detail: { reason: 'company could not be verified', status: 'NEEDS_REVIEW' },
    });
    // Must NOT appear: each fails one gate the main list also applies.
    await seed('suspicious', { validationStatus: 'SUSPICIOUS' });
    await seed('stale', { firstSeenAt: daysAgo(75) });
    await seed('experienced', { experienceLevel: 'EXPERIENCED', experienceMinYears: '3' });
    await seed('onsite-abroad', { locationCity: 'Berlin', locationCountry: 'Germany' });
    await seed('closed', { closedAt: daysAgo(1) });
    // A normal listed job, to prove the two views do not mix.
    await seed('valid', { status: 'VALID', validationStatus: 'VALID' });
  }, 180_000);

  afterAll(async () => {
    await db.delete(notifications).where(eq(notifications.userId, userId));
    await db.delete(jobs).where(eq(jobs.companyId, companyId));
    await db.delete(companies).where(eq(companies.id, companyId));
    await db.delete(users).where(eq(users.id, userId));
    if (userId) await supa.auth.admin.deleteUser(userId);
    await app.close();
  }, 120_000);

  const titles = (cards: { title: string }[]) => cards.map((c) => c.title.replace(`${tag} `, ''));

  it('lists held jobs with why each is held, and applies every list gate', async () => {
    const res = await api()
      .get('/api/v1/jobs/needs-review?limit=100')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const cards = (res.body as { data: ReviewJobCard[] }).data.filter((c) =>
      c.title.startsWith(tag),
    );
    // `CONTRACT_DUMP=<file>` writes this real response out as the web app's sample (docs/contracts).
    if (process.env.CONTRACT_DUMP) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(
        process.env.CONTRACT_DUMP,
        JSON.stringify({ ...res.body, data: cards }, null, 2),
      );
    }
    expect(titles(cards).sort()).toEqual(['category-held', 'company-held']);
    const byTitle = new Map(cards.map((c) => [titles([c])[0], c]));
    expect(byTitle.get('category-held')!.held).toMatchObject({
      kind: 'CATEGORY_UNKNOWN',
      label: 'Category unclear: the posting does not say what kind of work it is',
    });
    expect(byTitle.get('company-held')!.held).toMatchObject({
      kind: 'COMPANY_UNVERIFIED',
      label: 'Company not verified: the job board links only to its own page, not the employer',
    });
  });

  it('keeps the main list VALID-only: no held job appears there', async () => {
    const res = await api()
      .get('/api/v1/jobs?limit=100')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const mine = titles(
      (res.body as { data: JobCard[] }).data.filter((c) => c.title.startsWith(tag)),
    );
    expect(mine).toEqual(['valid']);
  });

  it('never sends a held job to Telegram: not instantly, not in the digest', async () => {
    await moduleRef.get(NotificationsService).enqueuePending({ userIds: [userId] });
    const sent = await db
      .select({ jobId: notifications.jobId })
      .from(notifications)
      .where(eq(notifications.userId, userId));
    const heldIds = Object.entries(ids)
      .filter(([k]) => k !== 'valid')
      .map(([, id]) => id);
    expect(sent.filter((n) => n.jobId && heldIds.includes(n.jobId))).toEqual([]);

    const digest = await moduleRef
      .get(DigestService)
      .build(userId, 'Asia/Kolkata', true, new Date());
    const digestIds = JSON.stringify(digest);
    for (const id of heldIds) expect(digestIds).not.toContain(id);
    expect(digest.counts.needsReview).toBe(0);
  });

  it('requires a signed-in user', async () => {
    await api().get('/api/v1/jobs/needs-review').expect(401);
  });

  it('cleans up only its own rows', async () => {
    const left = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(inArray(jobs.id, Object.values(ids)));
    expect(left).toHaveLength(Object.keys(ids).length);
  });
});
