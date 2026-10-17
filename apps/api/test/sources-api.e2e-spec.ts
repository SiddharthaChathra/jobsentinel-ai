import './helpers/test-env';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AI_SERVICE } from '../src/common/ai/ai.module';

/** Admin source management + system status (docs 03 §2 "Sources", §4). Uses the seeded live sources read-only where possible. */
const hasSupabase = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.DATABASE_URL,
);
const describeIf = hasSupabase ? describe : describe.skip;

describeIf('sources API (e2e)', () => {
  let app: INestApplication;
  let admin: SupabaseClient;
  const users: { id: string; token: string }[] = [];
  const adminEmail = `srcadmin-${Date.now()}@jobsentinel.test`;
  const plainEmail = `srcuser-${Date.now()}@jobsentinel.test`;
  const password = `Src-${Math.random().toString(36).slice(2)}-Pass1!`;

  beforeAll(async () => {
    process.env.ALLOWED_SIGNUP_EMAILS = '*';
    process.env.ADMIN_EMAILS = adminEmail;
    admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    for (const email of [adminEmail, plainEmail]) {
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error) throw new Error(created.error.message);
      const signIn = await anon.auth.signInWithPassword({ email, password });
      users.push({ id: created.data.user!.id, token: signIn.data.session!.access_token });
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_SERVICE)
      .useValue(null)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });
    await app.init();
  }, 60_000);

  afterAll(async () => {
    for (const u of users) await admin.auth.admin.deleteUser(u.id);
    await app?.close();
  }, 60_000);

  const asAdmin = () => ({ Authorization: `Bearer ${users[0]!.token}` });
  const asUser = () => ({ Authorization: `Bearer ${users[1]!.token}` });

  it('lists seeded sources with health for admins and rejects non-admins', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/sources')
      .set(asAdmin())
      .expect(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(30);
    expect(res.body.data[0]).toMatchObject({
      adapter: expect.any(String),
      status: expect.any(String),
      enabled: expect.any(Boolean),
    });
    const denied = await request(app.getHttpServer())
      .get('/api/v1/sources')
      .set(asUser())
      .expect(403);
    expect(denied.body.error.code).toBe('ADMIN_ONLY');
  });

  it('describes adapters with their config schema', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/sources/adapters')
      .set(asAdmin())
      .expect(200);
    const names = res.body.data.map((a: { adapter: string }) => a.adapter);
    expect(names).toEqual(
      expect.arrayContaining(['greenhouse', 'lever', 'ashby', 'remotive', 'rss']),
    );
    expect(
      res.body.data.find((a: { adapter: string }) => a.adapter === 'greenhouse').configSchema
        .properties,
    ).toHaveProperty('boardToken');
  });

  it('queues a manual scan and exposes scan history', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/sources')
      .set(asAdmin())
      .expect(200);
    const source = list.body.data.find((s: { enabled: boolean }) => s.enabled);
    await request(app.getHttpServer())
      .post(`/api/v1/sources/${source.id}/scan`)
      .set(asAdmin())
      .expect(202);
    const after = await request(app.getHttpServer())
      .get('/api/v1/sources')
      .set(asAdmin())
      .expect(200);
    expect(after.body.data.find((s: { id: string }) => s.id === source.id).manualRequested).toBe(
      true,
    );
    const runs = await request(app.getHttpServer())
      .get(`/api/v1/sources/${source.id}/scan-runs?limit=5`)
      .set(asAdmin())
      .expect(200);
    expect(Array.isArray(runs.body.data)).toBe(true);
  });

  it('validates new sources against the adapter schema', async () => {
    const bad = await request(app.getHttpServer())
      .post('/api/v1/sources')
      .set(asAdmin())
      .send({ name: 'Bad one', adapter: 'nope', config: {} })
      .expect(422);
    expect(bad.body.error.code).toBe('UNKNOWN_ADAPTER');
    const badConfig = await request(app.getHttpServer())
      .post('/api/v1/sources')
      .set(asAdmin())
      .send({ name: 'Bad config', adapter: 'greenhouse', config: { token: 'x' } })
      .expect(422);
    expect(badConfig.body.error.code).toBe('INVALID_SOURCE_CONFIG');
  });

  it('patching one field leaves the others alone, and rejects unknown fields', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/sources')
      .set(asAdmin())
      .expect(200);
    // Any source will do. The test sets the state it depends on rather than assuming what the
    // seed produced — which seed rows are enabled is a product decision that changes (D57).
    const source = list.body.data[0] as { id: string; enabled: boolean; priority: string };

    const disabled = await request(app.getHttpServer())
      .patch(`/api/v1/sources/${source.id}`)
      .set(asAdmin())
      .send({ enabled: false })
      .expect(200);
    expect(disabled.body.data).toMatchObject({ id: source.id, enabled: false });

    // The real invariant: a partial patch must not silently reset a field it was not given.
    const repriced = await request(app.getHttpServer())
      .patch(`/api/v1/sources/${source.id}`)
      .set(asAdmin())
      .send({ priority: 'LOW' })
      .expect(200);
    expect(repriced.body.data).toMatchObject({ id: source.id, priority: 'LOW', enabled: false });

    await request(app.getHttpServer())
      .patch(`/api/v1/sources/${source.id}`)
      .set(asAdmin())
      .send({ scanIntervalSec: 10 })
      .expect(400);

    // Put the source back the way it was found, so the suite leaves no trace.
    await request(app.getHttpServer())
      .patch(`/api/v1/sources/${source.id}`)
      .set(asAdmin())
      .send({ enabled: source.enabled, priority: source.priority })
      .expect(200);
  });

  it('system status is readable by any user', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/system/status')
      .set(asUser())
      .expect(200);
    expect(res.body.data.worker).toHaveProperty('alive');
    expect(res.body.data.sources.total).toBeGreaterThanOrEqual(30);
    expect(res.body.data.totals.jobs).toBeGreaterThan(0);
    expect(Array.isArray(res.body.data.lastScans)).toBe(true);
  });
});
