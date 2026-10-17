import { createHash } from 'node:crypto';
import { z } from 'zod';
import { allowedUnderPriority } from './budget-priority';
import { parseJsonLoose } from './json-repair';
import type { AIProvider, AIPurpose, AIRequest, AIResult, AIUsage } from './provider';

/**
 * Daily budget accounting. `InMemoryBudget` is the fallback for tests and for a run with no
 * database; the API/worker binds the `ai_calls`-backed implementation so a budget survives the
 * process (the worker is a short-lived `--once` process on a cron host).
 */
export interface BudgetPort {
  canSpend(purpose: AIPurpose): Promise<boolean>;
  record(entry: {
    purpose: AIPurpose;
    promptVersion: string;
    provider: string;
    model: string;
    status: AIResult<unknown>['status'];
    usage?: AIUsage;
    latencyMs: number;
    inputHash: string;
    meta?: AIRequest<unknown>['meta'];
  }): Promise<void>;
}

export interface CachePort {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export interface AILogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export class InMemoryBudget implements BudgetPort {
  private calls = 0;
  constructor(private readonly dailyCallBudget: number) {}
  /** Same priority ceilings as the database budget (F8, D105); tokens are not tracked here. */
  canSpend(purpose: AIPurpose): Promise<boolean> {
    return Promise.resolve(
      allowedUnderPriority(
        purpose,
        { calls: this.calls, tokens: 0 },
        { calls: this.dailyCallBudget, tokens: Number.POSITIVE_INFINITY },
      ),
    );
  }
  record(entry: { status: AIResult<unknown>['status'] }): Promise<void> {
    if (entry.status !== 'BUDGET_EXCEEDED' && entry.status !== 'UNAVAILABLE') this.calls += 1;
    return Promise.resolve();
  }
  get used(): number {
    return this.calls;
  }
}

export class InMemoryCache implements CachePort {
  private readonly map = new Map<string, unknown>();
  get(key: string): Promise<unknown> {
    return Promise.resolve(this.map.get(key));
  }
  set(key: string, value: unknown): Promise<void> {
    this.map.set(key, value);
    return Promise.resolve();
  }
}

export function hashInput(purpose: AIPurpose, promptVersion: string, input: unknown): string {
  return createHash('sha256')
    .update(`${purpose}|${promptVersion}|${stableStringify(input)}`)
    .digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

const REPAIR_SUFFIX =
  '\n\nYour previous answer was not valid for the required JSON schema. Problems:\n{{ISSUES}}\nReturn ONLY corrected JSON, no prose.';

/**
 * Provider-independent structured-output service (docs 09 §2):
 * cache → budget → provider chain → JSON repair → Zod validation → one repair retry → record.
 * Never throws for provider failures; callers branch on `status` and use deterministic fallbacks.
 */
export class AIService {
  private lastCallAt = 0;
  private cooldownUntil = 0;

  constructor(
    private readonly providers: AIProvider[],
    private readonly budget: BudgetPort,
    private readonly cache: CachePort,
    private readonly logger: AILogger,
    /**
     * Minimum gap between provider calls. The default keeps us under the 15 requests/minute of
     * Gemini's free tier with room to spare; a paid key can set it to 0.
     */
    private readonly minGapMs = 4_500,
  ) {
    if (providers.length === 0) throw new Error('AIService needs at least one provider');
  }

  /** Spaces calls out, and waits out any cooldown a 429 asked for. */
  private async pace(): Promise<void> {
    const waitFor = Math.max(
      this.lastCallAt + this.minGapMs - Date.now(),
      this.cooldownUntil - Date.now(),
    );
    if (waitFor > 0) await new Promise((resolve) => setTimeout(resolve, waitFor));
    this.lastCallAt = Date.now();
  }

  get primaryProvider(): AIProvider {
    return this.providers[0] as AIProvider;
  }

  async run<T>(req: AIRequest<T>): Promise<AIResult<T>> {
    const inputHash = hashInput(req.purpose, req.promptVersion, req.cacheKeyInput);
    const cacheKey = `${req.purpose}:${req.promptVersion}:${inputHash}`;

    const cached = await this.cache.get(cacheKey);
    if (cached !== undefined) {
      const parsed = req.schema.safeParse(cached);
      if (parsed.success) {
        return {
          status: 'OK',
          data: parsed.data,
          provider: 'cache',
          model: 'cache',
          usage: { inputTokens: 0, outputTokens: 0 },
          latencyMs: 0,
          cached: true,
        };
      }
    }

    if (!(await this.budget.canSpend(req.purpose))) {
      await this.budget.record({
        purpose: req.purpose,
        promptVersion: req.promptVersion,
        provider: '-',
        model: '-',
        status: 'BUDGET_EXCEEDED',
        latencyMs: 0,
        inputHash,
        meta: req.meta,
      });
      return { status: 'BUDGET_EXCEEDED', error: 'Daily AI budget exhausted' };
    }

    const jsonSchema = z.toJSONSchema(req.schema, { target: 'draft-7', io: 'input' });
    let lastError = 'no provider succeeded';
    let lastProvider: string | undefined;

    for (const provider of this.providers) {
      lastProvider = provider.name;
      const attempt = await this.attempt(provider, req, jsonSchema, inputHash);
      if (attempt.status === 'OK') {
        await this.cache.set(cacheKey, attempt.data);
        return attempt;
      }
      lastError = attempt.error;
      // INVALID_JSON after a repair retry is a model-quality problem — try the next provider too.
      this.logger.warn(
        {
          provider: provider.name,
          purpose: req.purpose,
          promptVersion: req.promptVersion,
          status: attempt.status,
          error: attempt.error,
        },
        'ai attempt failed',
      );
    }
    return {
      status: lastError.startsWith('INVALID_JSON') ? 'INVALID_JSON' : 'ERROR',
      error: lastError,
      provider: lastProvider,
    };
  }

  private async attempt<T>(
    provider: AIProvider,
    req: AIRequest<T>,
    jsonSchema: Record<string, unknown>,
    inputHash: string,
  ): Promise<AIResult<T>> {
    let userPrompt = req.user;
    for (let round = 0; round < 2; round++) {
      // A free tier limits requests per MINUTE, not just per day, and the daily budget cannot
      // see that. Without pacing, a batch burns the per-minute allowance in seconds and every
      // remaining call fails 429 (D58).
      await this.pace();
      const startedAt = Date.now();
      let text: string;
      let usage: AIUsage;
      try {
        ({ text, usage } = await provider.complete({
          system: req.system,
          user: userPrompt,
          jsonSchema,
          maxOutputTokens: req.maxOutputTokens,
          temperature: req.temperature ?? 0.1,
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // A 429 tells us exactly how long to wait; respecting it costs one pause, ignoring it
        // costs every remaining call in the batch.
        const retryAfterMs = parseRetryAfterMs(message);
        if (retryAfterMs !== null) this.cooldownUntil = Date.now() + retryAfterMs;
        await this.budget.record({
          purpose: req.purpose,
          promptVersion: req.promptVersion,
          provider: provider.name,
          model: provider.model,
          status: 'ERROR',
          latencyMs: Date.now() - startedAt,
          inputHash,
          meta: req.meta,
        });
        return { status: 'ERROR', error: message, provider: provider.name };
      }
      const latencyMs = Date.now() - startedAt;
      const raw = parseJsonLoose(text);
      const parsed = raw === undefined ? undefined : req.schema.safeParse(raw);
      if (parsed?.success) {
        await this.budget.record({
          purpose: req.purpose,
          promptVersion: req.promptVersion,
          provider: provider.name,
          model: provider.model,
          status: 'OK',
          usage,
          latencyMs,
          inputHash,
          meta: req.meta,
        });
        this.logger.info(
          {
            provider: provider.name,
            model: provider.model,
            purpose: req.purpose,
            promptVersion: req.promptVersion,
            latencyMs,
            usage,
            round,
          },
          'ai ok',
        );
        return {
          status: 'OK',
          data: parsed.data,
          provider: provider.name,
          model: provider.model,
          usage,
          latencyMs,
          cached: false,
        };
      }
      const issues =
        raw === undefined
          ? 'output was not parseable JSON'
          : (parsed?.error.issues ?? [])
              .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
              .join('\n');
      await this.budget.record({
        purpose: req.purpose,
        promptVersion: req.promptVersion,
        provider: provider.name,
        model: provider.model,
        status: 'INVALID_JSON',
        usage,
        latencyMs,
        inputHash,
        meta: req.meta,
      });
      userPrompt = `${req.user}${REPAIR_SUFFIX.replace('{{ISSUES}}', issues)}`;
    }
    return {
      status: 'INVALID_JSON',
      error: 'INVALID_JSON: output failed schema validation after repair retry',
      provider: provider.name,
    };
  }
}

/**
 * Reads a provider's "retry after" hint out of its error text. Gemini phrases it as
 * "Please retry in 18.02s"; a plain `retry_after: 30` is also accepted. Returns null when the
 * error carries no hint, in which case only the normal pacing applies.
 */
export function parseRetryAfterMs(message: string): number | null {
  if (!/\b429\b|quota|rate.?limit/i.test(message)) return null;
  const seconds =
    /retry in ([0-9.]+)s/i.exec(message)?.[1] ??
    /retry_?after["':\s]+([0-9.]+)/i.exec(message)?.[1];
  if (seconds === undefined) return 30_000; // rate-limited but no hint: back off a sensible default
  const ms = Math.round(Number(seconds) * 1000);
  return Number.isFinite(ms) ? Math.min(Math.max(ms, 1_000), 120_000) : 30_000;
}
