import { and, desc, eq, gte, sql } from 'drizzle-orm';
import {
  allowedUnderPriority,
  withinUserLimit,
  type AIPurpose,
  type BudgetPort,
  type CachePort,
} from '@jobsentinel/ai';
import { aiCalls, aiUsage } from '../db/schema';
import type { Db } from '../db/db.module';

/** Kept in step with the port by construction, so a change there is a compile error here. */
type BudgetEntry = Parameters<BudgetPort['record']>[0];

/**
 * Budget accounting (docs 09 §6, F8). Every call is logged in `ai_calls` (the per-call ledger and
 * response cache) and added to today's `ai_usage` row for its user and provider; the check before
 * each call reads `ai_usage` — the global budget by priority tier (D105) and the caller's own
 * daily limit (D112).
 *
 * The worker is normally a short-lived `--once` process on a cron host, so an in-process counter
 * would reset the daily budget on every tick and never actually cap anything. Rows make the
 * budget real, and give the dashboard a usage figure for free.
 *
 * The day boundary is UTC: it is unambiguous, and the budget exists to stay inside a provider's
 * free tier rather than to line up with the user's calendar.
 */
export class DbBudget implements BudgetPort {
  constructor(
    private readonly db: Db,
    private readonly dailyCallBudget: number,
    private readonly dailyTokenBudget: number,
    private readonly userCallLimit: number = Number.POSITIVE_INFINITY,
  ) {}

  async canSpend(purpose: AIPurpose, meta?: BudgetEntry['meta']): Promise<boolean> {
    const userId = meta?.userId ?? null;
    // One read: today's totals, and the caller's share when the call is made for a user.
    const [row] = await this.db
      .select({
        calls: sql<number>`coalesce(sum(${aiUsage.calls}), 0)::int`,
        tokens: sql<number>`coalesce(sum(${aiUsage.tokens}), 0)::int`,
        userCalls: userId
          ? sql<number>`coalesce(sum(${aiUsage.calls}) filter (where ${aiUsage.userId} = ${userId}::uuid), 0)::int`
          : sql<null>`null`,
      })
      .from(aiUsage)
      .where(eq(aiUsage.usageDate, utcDay()));
    if (!row) return true;
    return (
      allowedUnderPriority(purpose, row, {
        calls: this.dailyCallBudget,
        tokens: this.dailyTokenBudget,
      }) && withinUserLimit(purpose, row.userCalls, this.userCallLimit)
    );
  }

  async record(entry: BudgetEntry): Promise<void> {
    // Accounting must never break the pipeline: a failed insert costs a log line, not a stage.
    const tokens = (entry.usage?.inputTokens ?? 0) + (entry.usage?.outputTokens ?? 0);
    try {
      await this.db.insert(aiCalls).values({
        provider: entry.provider,
        model: entry.model,
        purpose: entry.purpose,
        promptVersion: entry.promptVersion,
        inputHash: entry.inputHash,
        inputTokens: entry.usage?.inputTokens ?? 0,
        outputTokens: entry.usage?.outputTokens ?? 0,
        latencyMs: entry.latencyMs,
        status: entry.status,
        jobId: entry.meta?.jobId ?? null,
        userId: entry.meta?.userId ?? null,
      });
      // A refused call (no budget) or an unreachable provider spent nothing.
      if (entry.status === 'BUDGET_EXCEEDED' || entry.status === 'UNAVAILABLE') return;
      await this.db
        .insert(aiUsage)
        .values({
          usageDate: utcDay(),
          userId: entry.meta?.userId ?? null,
          provider: entry.provider,
          calls: 1,
          tokens,
        })
        .onConflictDoUpdate({
          target: [aiUsage.usageDate, aiUsage.userId, aiUsage.provider],
          set: {
            calls: sql`${aiUsage.calls} + 1`,
            tokens: sql`${aiUsage.tokens} + ${tokens}`,
            updatedAt: new Date(),
          },
        });
    } catch {
      /* accounting is best-effort */
    }
  }

  /** Today's usage, for `/system/status` and the dashboard. */
  async usage(): Promise<{
    calls: number;
    tokens: number;
    callBudget: number;
    tokenBudget: number;
    /** Calls today per purpose, for System Status (F8, D105). */
    byPurpose: Record<string, number>;
    /** Per-user daily limit (F8, D112). */
    userCallLimit: number;
  }> {
    const perPurpose = await this.db
      .select({
        purpose: aiCalls.purpose,
        calls: sql<number>`count(*) filter (where ${aiCalls.status} not in ('BUDGET_EXCEEDED','UNAVAILABLE'))::int`,
      })
      .from(aiCalls)
      .where(gte(aiCalls.createdAt, startOfUtcDay()))
      .groupBy(aiCalls.purpose);
    const [row] = await this.db
      .select({
        calls: sql<number>`coalesce(sum(${aiUsage.calls}), 0)::int`,
        tokens: sql<number>`coalesce(sum(${aiUsage.tokens}), 0)::int`,
      })
      .from(aiUsage)
      .where(eq(aiUsage.usageDate, utcDay()));
    return {
      calls: row?.calls ?? 0,
      tokens: row?.tokens ?? 0,
      callBudget: this.dailyCallBudget,
      tokenBudget: this.dailyTokenBudget,
      byPurpose: Object.fromEntries(perPurpose.map((r) => [r.purpose, r.calls])),
      userCallLimit: Number.isFinite(this.userCallLimit) ? this.userCallLimit : 0,
    };
  }
}

/**
 * Response cache backed by the same `ai_calls` rows (docs 09 §6). Identical input ⇒ free answer,
 * across processes and across days — which matters most for `JOB_REQUIREMENTS`, where the same
 * posting is re-scored every time the profile changes.
 *
 * `AIService` builds the key as `purpose:promptVersion:inputHash`, which is exactly the
 * `ai_calls_cache_idx` index, so the lookup is a single index hit.
 */
export class DbCache implements CachePort {
  constructor(
    private readonly db: Db,
    private readonly maxAgeDays: number,
  ) {}

  async get(key: string): Promise<unknown> {
    const parts = splitKey(key);
    if (!parts) return undefined;
    const cutoff = new Date(Date.now() - this.maxAgeDays * 24 * 60 * 60 * 1000);
    try {
      const [row] = await this.db
        .select({ response: aiCalls.response })
        .from(aiCalls)
        .where(
          and(
            eq(aiCalls.purpose, parts.purpose),
            eq(aiCalls.promptVersion, parts.promptVersion),
            eq(aiCalls.inputHash, parts.inputHash),
            eq(aiCalls.status, 'OK'),
            gte(aiCalls.createdAt, cutoff),
            sql`${aiCalls.response} is not null`,
          ),
        )
        .orderBy(desc(aiCalls.createdAt))
        .limit(1);
      return row?.response ?? undefined;
    } catch {
      return undefined; // a cache that errors is just a cache miss
    }
  }

  /**
   * `AIService` records the call and then caches the value, so the row this writes to is the one
   * just inserted for this exact input. Two workers racing here would write the same value.
   */
  async set(key: string, value: unknown): Promise<void> {
    const parts = splitKey(key);
    if (!parts) return;
    try {
      await this.db
        .update(aiCalls)
        .set({ response: value })
        .where(
          sql`${aiCalls.id} = (
            select id from ${aiCalls}
            where purpose = ${parts.purpose}
              and prompt_version = ${parts.promptVersion}
              and input_hash = ${parts.inputHash}
              and status = 'OK'
            order by created_at desc
            limit 1
          )`,
        );
    } catch {
      /* caching is best-effort */
    }
  }
}

/** `purpose:promptVersion:inputHash` — neither purpose nor prompt version contains a colon. */
function splitKey(
  key: string,
): { purpose: string; promptVersion: string; inputHash: string } | null {
  const parts = key.split(':');
  if (parts.length !== 3) return null;
  const [purpose, promptVersion, inputHash] = parts as [string, string, string];
  return { purpose, promptVersion, inputHash };
}

/** Today's UTC date as `YYYY-MM-DD`, the `ai_usage.usage_date` key. */
function utcDay(): string {
  return startOfUtcDay().toISOString().slice(0, 10);
}

function startOfUtcDay(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
