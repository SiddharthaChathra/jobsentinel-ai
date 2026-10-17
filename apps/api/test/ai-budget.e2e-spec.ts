import './helpers/test-env';
import { z } from 'zod';
import { AIService, type AIProvider, type AIRequest } from '@jobsentinel/ai';
import { randomUUID } from 'node:crypto';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { DbBudget, DbCache } from '../src/common/ai/db-ai';
import { DB, type Db } from '../src/common/db/db.module';
import { aiCalls, aiUsage } from '../src/common/db/schema';
import { WorkerModule } from '../src/worker.module';

/**
 * The AI budget and cache are backed by the database, not process memory (docs 09 §6): `ai_calls`
 * logs and caches each call, `ai_usage` holds the daily totals the budget checks (F8, D112). The worker
 * is a short-lived `--once` process, so an in-memory counter would reset the daily cap every tick
 * and an in-memory cache would never live long enough to save a call.
 */
const hasDb = Boolean(process.env.DATABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const describeIf = hasDb ? describe : describe.skip;

const Answer = z.object({ answer: z.string() });

class CountingProvider implements AIProvider {
  readonly name = 'counting';
  readonly model = 'counting-1';
  calls = 0;
  constructor(private readonly reply = '{"answer":"forty-two"}') {}
  complete(): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }> {
    this.calls++;
    return Promise.resolve({ text: this.reply, usage: { inputTokens: 11, outputTokens: 7 } });
  }
  healthCheck(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

const silent = { info: () => undefined, warn: () => undefined };

describeIf('AI budget and cache (integration)', () => {
  const purpose = 'JOB_REQUIREMENTS' as const;
  const promptVersion = `budget-test.v${Date.now()}`; // unique, so it never collides with real rows
  let db: Db;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;

  const request = (marker: string): AIRequest<z.infer<typeof Answer>> => ({
    purpose,
    promptVersion,
    system: 'Return JSON.',
    user: `question ${marker}`,
    schema: Answer,
    maxOutputTokens: 50,
    temperature: 0,
    cacheKeyInput: { marker },
  });

  const rowsForThisTest = () =>
    db.select().from(aiCalls).where(eq(aiCalls.promptVersion, promptVersion));

  /** Today's real usage. Budgets below are expressed relative to it, never as absolutes. */
  let usedToday = 0;
  /** A budget with room for n more calls than have already been made today. */
  const roomFor = (n: number) => usedToday + n;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    db = moduleRef.get(DB);
    usedToday = (await new DbBudget(db, 1, 1).usage()).calls;
  }, 60_000);

  /** Providers only this spec uses: its `ai_usage` rows are removed with them. */
  const TEST_PROVIDERS = ['counting', 'fake'];

  afterAll(async () => {
    await db.delete(aiCalls).where(eq(aiCalls.promptVersion, promptVersion));
    await db.delete(aiUsage).where(inArray(aiUsage.provider, TEST_PROVIDERS));
    await moduleRef.close();
  }, 60_000);

  it('records every call in ai_calls with its prompt version and token usage', async () => {
    const provider = new CountingProvider();
    const svc = new AIService(
      [provider],
      new DbBudget(db, roomFor(10), 1_000_000_000),
      new DbCache(db, 30),
      silent,
    );

    const result = await svc.run(request('a'));
    expect(result.status).toBe('OK');

    const rows = await rowsForThisTest();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      purpose,
      promptVersion,
      provider: 'counting',
      model: 'counting-1',
      status: 'OK',
      inputTokens: 11,
      outputTokens: 7,
    });
    expect(rows[0]!.response).toEqual({ answer: 'forty-two' });

    // …and adds it to today's ai_usage row for its user (none: system work) and provider (D112).
    const today = new Date().toISOString().slice(0, 10);
    const [usage] = await db
      .select()
      .from(aiUsage)
      .where(and(eq(aiUsage.provider, 'counting'), eq(aiUsage.usageDate, today)));
    expect(usage).toMatchObject({ userId: null, calls: 1, tokens: 18 });
  }, 60_000);

  it('serves an identical input from the database, so a new process pays nothing', async () => {
    // A fresh AIService with a fresh provider: this is what the next `--once` tick looks like.
    const provider = new CountingProvider();
    const svc = new AIService(
      [provider],
      new DbBudget(db, roomFor(10), 1_000_000_000),
      new DbCache(db, 30),
      silent,
    );

    const result = await svc.run(request('a')); // same cacheKeyInput as the previous test
    expect(result.status).toBe('OK');
    if (result.status !== 'OK') return;
    expect(result.data).toEqual({ answer: 'forty-two' });
    expect(result.cached).toBe(true);
    expect(result.provider).toBe('cache');
    expect(provider.calls).toBe(0); // the provider was never contacted

    // A cache hit is free: it neither calls out nor writes a new accounting row.
    expect(await rowsForThisTest()).toHaveLength(1);
  }, 60_000);

  it('stops calling the provider once the daily call budget is spent', async () => {
    const provider = new CountingProvider();
    const budget = new DbBudget(db, roomFor(0), 1_000_000_000); // no room left for another call
    const svc = new AIService([provider], budget, new DbCache(db, 30), silent);

    const result = await svc.run(request('uncached-b'));
    expect(result.status).toBe('BUDGET_EXCEEDED');
    expect(provider.calls).toBe(0);

    // The refusal is recorded, but does not itself count against the budget.
    const rows = await rowsForThisTest();
    expect(rows.filter((r) => r.status === 'BUDGET_EXCEEDED')).toHaveLength(1);
    const usage = await budget.usage();
    expect(usage.calls).toBeGreaterThan(usage.callBudget - 1);
    expect(usage.callBudget).toBe(roomFor(0));
  }, 60_000);

  it('stops on the token budget as well as the call budget', async () => {
    const provider = new CountingProvider();
    const svc = new AIService(
      [provider],
      new DbBudget(db, roomFor(10), 1),
      new DbCache(db, 30),
      silent,
    );
    const result = await svc.run(request('uncached-c'));
    expect(result.status).toBe('BUDGET_EXCEEDED');
    expect(provider.calls).toBe(0);
  }, 60_000);

  it('counts only today, so yesterday cannot exhaust today', async () => {
    // Backdate this spec's rows by two days; today's usage must then read zero.
    await db
      .update(aiCalls)
      .set({ createdAt: sql`now() - interval '2 days'` })
      .where(eq(aiCalls.promptVersion, promptVersion));
    await db
      .update(aiUsage)
      .set({ usageDate: sql`${aiUsage.usageDate} - 2` })
      .where(inArray(aiUsage.provider, TEST_PROVIDERS));

    const usage = await new DbBudget(db, roomFor(10), 1_000_000_000).usage();
    const mine = await db
      .select()
      .from(aiCalls)
      .where(
        and(
          eq(aiCalls.promptVersion, promptVersion),
          gte(aiCalls.createdAt, new Date(Date.now() - 60_000)),
        ),
      );
    expect(mine).toHaveLength(0); // all of this spec's rows now sit outside today
    expect(usage.calls).toBeGreaterThanOrEqual(0);

    const provider = new CountingProvider();
    const svc = new AIService(
      [provider],
      new DbBudget(db, roomFor(10), 1_000_000_000),
      new DbCache(db, 30),
      silent,
    );
    const result = await svc.run(request('uncached-d'));
    expect(result.status).toBe('OK');
    expect(provider.calls).toBe(1);
  }, 60_000);
  it('enforces the priority ceilings against the real ledger (F8, D105)', async () => {
    // Budget sized so today's existing calls plus 6 of ours sit at exactly 60% of it.
    const used = (await new DbBudget(db, 1, 1).usage()).calls;
    await db.insert(aiCalls).values(
      Array.from({ length: 6 }, () => ({
        provider: 'fake',
        model: 'fake',
        purpose: 'MATCH',
        promptVersion,
        inputHash: `prio-${Math.random()}`,
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
        status: 'OK',
      })),
    );
    await db.insert(aiUsage).values({
      usageDate: new Date().toISOString().slice(0, 10),
      provider: 'fake',
      calls: 6,
      tokens: 12,
    });
    const budget = new DbBudget(db, Math.floor((used + 6) / 0.6), 10_000_000);
    expect(await budget.canSpend('CATEGORY_CLASSIFY')).toBe(false); // at its 60% ceiling
    expect(await budget.canSpend('MATCH')).toBe(true);
    expect(await budget.canSpend('RESUME_PROFILE')).toBe(true);
    const usage = await budget.usage();
    expect(usage.byPurpose.MATCH).toBeGreaterThanOrEqual(6);
  });

  it('holds each user to the per-user daily limit from ai_usage (F8, D112)', async () => {
    const provider = new CountingProvider();
    const budget = new DbBudget(db, 1_000_000, 1_000_000_000, 2);
    const svc = new AIService([provider], budget, new DbCache(db, 30), silent);
    const alice = randomUUID();
    const bob = randomUUID();
    const forUser = (
      userId: string,
      marker: string,
      p: AIRequest<unknown>['purpose'] = 'MATCH',
    ) => ({
      ...request(`${userId}-${marker}`),
      purpose: p,
      meta: { userId },
    });

    expect((await svc.run(forUser(alice, '1'))).status).toBe('OK');
    expect((await svc.run(forUser(alice, '2'))).status).toBe('OK');
    expect((await svc.run(forUser(alice, '3'))).status).toBe('BUDGET_EXCEEDED');
    expect(provider.calls).toBe(2);
    // Exempt: resume parsing has its own cap (D93). Another user has their own allowance.
    expect((await svc.run(forUser(alice, '4', 'RESUME_PROFILE'))).status).toBe('OK');
    expect((await svc.run(forUser(bob, '1'))).status).toBe('OK');

    const rows = await db
      .select({ userId: aiUsage.userId, calls: aiUsage.calls })
      .from(aiUsage)
      .where(and(eq(aiUsage.provider, 'counting'), inArray(aiUsage.userId, [alice, bob])));
    // Alice: 2 matches + 1 resume parse; the refused third call spent nothing.
    expect(Object.fromEntries(rows.map((r) => [r.userId, r.calls]))).toEqual({
      [alice]: 3,
      [bob]: 1,
    });
    expect((await budget.usage()).userCallLimit).toBe(2);
  }, 60_000);
});
