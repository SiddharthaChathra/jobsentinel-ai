import { z } from 'zod';
import {
  AIService,
  InMemoryBudget,
  InMemoryCache,
  hashInput,
  parseRetryAfterMs,
} from './ai-service';
import type { AIProvider, AIRequest, ProviderCompletionResponse } from './provider';

const Out = z.object({
  level: z.enum(['FRESHER', 'EXPERIENCED']),
  confidence: z.number().min(0).max(1),
});

/** Scripted provider: each call returns the next scripted text or throws. */
class FakeProvider implements AIProvider {
  readonly model = 'fake-1';
  calls: string[] = [];
  constructor(
    readonly name: string,
    private readonly script: (string | Error)[],
  ) {}
  complete(req: { user: string }): Promise<ProviderCompletionResponse> {
    this.calls.push(req.user);
    const next = this.script.shift();
    if (next === undefined) return Promise.reject(new Error('script exhausted'));
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve({ text: next, usage: { inputTokens: 10, outputTokens: 5 } });
  }
  healthCheck(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

const logger = { info: () => undefined, warn: () => undefined };
const req = (): AIRequest<z.infer<typeof Out>> => ({
  purpose: 'FRESHER_CLASSIFY',
  promptVersion: 'v1',
  system: 's',
  user: 'classify this',
  schema: Out,
  maxOutputTokens: 100,
  cacheKeyInput: { text: 'classify this' },
});

describe('AIService', () => {
  it('returns validated data on a clean response', async () => {
    const p = new FakeProvider('a', ['{"level":"FRESHER","confidence":0.9}']);
    const svc = new AIService([p], new InMemoryBudget(10), new InMemoryCache(), logger, 0);
    const r = await svc.run(req());
    expect(r.status).toBe('OK');
    if (r.status === 'OK') expect(r.data).toEqual({ level: 'FRESHER', confidence: 0.9 });
  });

  it('repairs fenced JSON, then retries once with the validation issues appended', async () => {
    const p = new FakeProvider('a', [
      '```json\n{"level":"SENIOR","confidence":2}\n```',
      '{"level":"EXPERIENCED","confidence":0.7}',
    ]);
    const svc = new AIService([p], new InMemoryBudget(10), new InMemoryCache(), logger, 0);
    const r = await svc.run(req());
    expect(r.status).toBe('OK');
    expect(p.calls).toHaveLength(2);
    expect(p.calls[1]).toMatch(/not valid for the required JSON schema/);
    expect(p.calls[1]).toMatch(/level/);
  });

  it('fails over to the next provider on error and reports INVALID_JSON when all fail validation', async () => {
    const a = new FakeProvider('a', [new Error('503 overloaded')]);
    const b = new FakeProvider('b', ['not json', 'still not json']);
    const svc = new AIService([a, b], new InMemoryBudget(10), new InMemoryCache(), logger, 0);
    const r = await svc.run(req());
    expect(r.status).toBe('INVALID_JSON');
    expect(b.calls).toHaveLength(2);
  });

  it('serves repeated inputs from cache without spending budget', async () => {
    const p = new FakeProvider('a', ['{"level":"FRESHER","confidence":0.9}']);
    const budget = new InMemoryBudget(10);
    const svc = new AIService([p], budget, new InMemoryCache(), logger, 0);
    await svc.run(req());
    const r2 = await svc.run(req());
    expect(r2.status).toBe('OK');
    if (r2.status === 'OK') expect(r2.cached).toBe(true);
    expect(budget.used).toBe(1);
    expect(p.calls).toHaveLength(1);
  });

  it('returns BUDGET_EXCEEDED without calling the provider', async () => {
    const p = new FakeProvider('a', ['{"level":"FRESHER","confidence":0.9}']);
    const svc = new AIService([p], new InMemoryBudget(0), new InMemoryCache(), logger, 0);
    const r = await svc.run(req());
    expect(r.status).toBe('BUDGET_EXCEEDED');
    expect(p.calls).toHaveLength(0);
  });

  it('stops one user at their daily limit, without touching other users or resume parsing (F8, D112)', async () => {
    const ok = '{"level":"FRESHER","confidence":0.9}';
    const p = new FakeProvider('a', [ok, ok, ok, ok]);
    const svc = new AIService([p], new InMemoryBudget(100, 2), new InMemoryCache(), logger, 0);
    const forUser = (userId: string, n: number, purpose: AIRequest<unknown>['purpose']) => ({
      ...req(),
      purpose,
      cacheKeyInput: { userId, n }, // distinct inputs: no cache hits
      meta: { userId },
    });
    expect((await svc.run(forUser('u1', 1, 'MATCH'))).status).toBe('OK');
    expect((await svc.run(forUser('u1', 2, 'MATCH'))).status).toBe('OK');
    const third = await svc.run(forUser('u1', 3, 'MATCH'));
    expect(third.status).toBe('BUDGET_EXCEEDED');
    expect(p.calls).toHaveLength(2); // the provider was never asked for the third
    // Resume parsing is exempt (its own cap, D93); another user has their own allowance.
    expect((await svc.run(forUser('u1', 4, 'RESUME_PROFILE'))).status).toBe('OK');
    expect((await svc.run(forUser('u2', 1, 'MATCH'))).status).toBe('OK');
    // System work (no user) is limited only by the global budget.
    expect((await svc.run({ ...req(), cacheKeyInput: { n: 9 } })).status).not.toBe(
      'BUDGET_EXCEEDED',
    );
  });

  it('hashInput is stable across key order', () => {
    expect(hashInput('MATCH', 'v1', { a: 1, b: [1, 2] })).toBe(
      hashInput('MATCH', 'v1', { b: [1, 2], a: 1 }),
    );
  });
});

describe('parseRetryAfterMs', () => {
  it('reads the delay Gemini suggests', () => {
    expect(
      parseRetryAfterMs(
        'gemini 429: You exceeded your current quota. Please retry in 18.026912833s.',
      ),
    ).toBe(18027);
  });

  it('reads a plain retry_after and a bare rate-limit message', () => {
    expect(parseRetryAfterMs('429 rate limit, retry_after: 30')).toBe(30_000);
    expect(parseRetryAfterMs('HTTP 429 quota exceeded')).toBe(30_000);
  });

  it('clamps absurd values and ignores unrelated errors', () => {
    expect(parseRetryAfterMs('429 quota, please retry in 9999s')).toBe(120_000);
    expect(parseRetryAfterMs('429 quota, please retry in 0.1s')).toBe(1_000);
    expect(parseRetryAfterMs('500 internal error')).toBeNull();
    expect(parseRetryAfterMs('model returned invalid JSON')).toBeNull();
  });
});
