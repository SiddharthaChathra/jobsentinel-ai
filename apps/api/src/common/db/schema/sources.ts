import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import {
  scanStatusEnum,
  scanTriggerEnum,
  sourcePriorityEnum,
  sourceStatusEnum,
  sourceTypeEnum,
} from './enums';
import { readAllPolicy, timestamps } from './shared';

// ── job_sources (docs 02 §3.3, 06) ──────────────────────────────────────────────
export const jobSources = pgTable(
  'job_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().unique(),
    type: sourceTypeEnum('type').notNull(),
    adapter: text('adapter').notNull(),
    baseUrl: text('base_url'),
    config: jsonb('config').notNull().default({}),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
    enabled: boolean('enabled').notNull().default(true),
    priority: sourcePriorityEnum('priority').notNull().default('NORMAL'),
    scanIntervalSec: integer('scan_interval_sec'),
    minRequestGapMs: integer('min_request_gap_ms').notNull().default(1000),
    nextScanAt: timestamp('next_scan_at', { withTimezone: true }),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    manualRequestedAt: timestamp('manual_requested_at', { withTimezone: true }),
    lastAttemptedScan: timestamp('last_attempted_scan', { withTimezone: true }),
    lastSuccessfulScan: timestamp('last_successful_scan', { withTimezone: true }),
    lastCursor: text('last_cursor'),
    lastSeenExternalId: text('last_seen_external_id'),
    lastError: text('last_error'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    status: sourceStatusEnum('status').notNull().default('ACTIVE'),
    robotsCheckedAt: timestamp('robots_checked_at', { withTimezone: true }),
    robotsAllowed: boolean('robots_allowed'),
    // Auto-pause (F2, D103): why and when; resumedAt restarts the 30-day grace period.
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    pausedReason: text('paused_reason'),
    resumedAt: timestamp('resumed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('job_sources_due_idx')
      .on(t.nextScanAt)
      .where(sql`enabled = true`),
    readAllPolicy('job_sources'),
  ],
).enableRLS();

// ── scan_runs ─────────────────────────────────────────────────────────────────
export const scanRuns = pgTable(
  'scan_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => jobSources.id, { onDelete: 'cascade' }),
    trigger: scanTriggerEnum('trigger').notNull().default('SCHEDULED'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    status: scanStatusEnum('status').notNull().default('RUNNING'),
    windowFrom: timestamp('window_from', { withTimezone: true }),
    windowTo: timestamp('window_to', { withTimezone: true }),
    jobsFound: integer('jobs_found').notNull().default(0),
    jobsNew: integer('jobs_new').notNull().default(0),
    jobsUpdated: integer('jobs_updated').notNull().default(0),
    jobsSkipped: integer('jobs_skipped').notNull().default(0),
    requestsMade: integer('requests_made').notNull().default(0),
    errorMessage: text('error_message'),
    durationMs: integer('duration_ms'),
    ...timestamps,
  },
  (t) => [
    index('scan_runs_source_idx').on(t.sourceId, t.startedAt.desc()),
    readAllPolicy('scan_runs'),
  ],
).enableRLS();
