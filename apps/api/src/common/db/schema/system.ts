import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { logLevelEnum } from './enums';

/**
 * System tables have no RLS policies at all: with RLS enabled and no policy, only the service
 * role can read/write them (docs 02 §6).
 */

// ── system_logs (business events; 30-day retention) ───────────────────────────
export const systemLogs = pgTable(
  'system_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    level: logLevelEnum('level').notNull().default('INFO'),
    category: text('category').notNull(),
    message: text('message').notNull(),
    context: jsonb('context').notNull().default({}),
    sourceId: uuid('source_id'),
    jobId: uuid('job_id'),
    userId: uuid('user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('system_logs_created_idx').on(t.createdAt.desc()),
    index('system_logs_category_idx').on(t.category, t.createdAt.desc()),
  ],
).enableRLS();

// ── ai_calls (budget accounting + response cache; 60-day retention) ───────────
export const aiCalls = pgTable(
  'ai_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    purpose: text('purpose').notNull(),
    promptVersion: text('prompt_version').notNull(),
    inputHash: text('input_hash').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    status: text('status').notNull(),
    jobId: uuid('job_id'),
    userId: uuid('user_id'),
    response: jsonb('response'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Cache hits look up by (purpose, prompt_version, input_hash) among successful calls.
    index('ai_calls_cache_idx').on(t.purpose, t.promptVersion, t.inputHash),
    index('ai_calls_created_idx').on(t.createdAt.desc()),
  ],
).enableRLS();

// ── worker_heartbeats ─────────────────────────────────────────────────────────
export const workerHeartbeats = pgTable('worker_heartbeats', {
  workerId: text('worker_id').primaryKey(),
  hostname: text('hostname').notNull(),
  version: text('version').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  lastBeatAt: timestamp('last_beat_at', { withTimezone: true }).notNull().defaultNow(),
  currentTask: text('current_task'),
  once: integer('once').notNull().default(0),
}).enableRLS();
