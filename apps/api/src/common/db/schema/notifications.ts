import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  notificationChannelEnum,
  notificationModeEnum,
  notificationStatusEnum,
  notificationTypeEnum,
  reminderKindEnum,
  reminderStatusEnum,
} from './enums';
import { users } from './identity';
import { jobs } from './jobs';
import { ownerPolicy, timestamps } from './shared';

// ── notification_settings (1:1) ───────────────────────────────────────────────
export const notificationSettings = pgTable(
  'notification_settings',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    mode: notificationModeEnum('mode').notNull().default('BOTH'),
    digestHourLocal: smallint('digest_hour_local').notNull().default(8),
    quietHoursStart: smallint('quiet_hours_start'),
    quietHoursEnd: smallint('quiet_hours_end'),
    instantMinScore: smallint('instant_min_score').notNull().default(75),
    includeNeedsReviewInDigest: boolean('include_needs_review_in_digest').notNull().default(true),
    telegramEnabled: boolean('telegram_enabled').notNull().default(true),
    pausedUntil: timestamp('paused_until', { withTimezone: true }),
    // Tracker reminders (F5, D119) and the weekly summary (F6, opt-in).
    remindersEnabled: boolean('reminders_enabled').notNull().default(true),
    followUpDays: smallint('follow_up_days').notNull().default(7),
    weeklySummaryEnabled: boolean('weekly_summary_enabled').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    check('notification_settings_follow_up_days', sql`${t.followUpDays} between 3 and 14`),
    ownerPolicy('notification_settings'),
  ],
).enableRLS();

// ── telegram_links ────────────────────────────────────────────────────────────
export const telegramLinks = pgTable(
  'telegram_links',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    chatId: bigint('chat_id', { mode: 'bigint' }).unique(),
    telegramUsername: text('telegram_username'),
    linkCode: text('link_code').unique(),
    linkCodeExpiresAt: timestamp('link_code_expires_at', { withTimezone: true }),
    linkedAt: timestamp('linked_at', { withTimezone: true }),
    ...timestamps,
  },
  () => [ownerPolicy('telegram_links')],
).enableRLS();

// ── notifications ─────────────────────────────────────────────────────────────
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
    channel: notificationChannelEnum('channel').notNull(),
    type: notificationTypeEnum('type').notNull(),
    status: notificationStatusEnum('status').notNull().default('PENDING'),
    payload: jsonb('payload').notNull().default({}),
    digestDate: date('digest_date'),
    sendAfter: timestamp('send_after', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    readAt: timestamp('read_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // "Never notify twice for the same job" (docs 10 §2) — enforced here, not in code.
    uniqueIndex('notifications_user_job_channel_type_idx')
      .on(t.userId, t.jobId, t.channel, t.type)
      .where(sql`job_id is not null`),
    // One digest per user, channel and local day.
    uniqueIndex('notifications_digest_once_idx')
      .on(t.userId, t.channel, t.digestDate)
      .where(sql`type = 'DIGEST'`),
    // One weekly summary per user, channel and week (digest_date = the week's Sunday, F6). Keyed
    // on the type column rather than a `type = 'WEEKLY'` predicate: a value added to an enum
    // cannot be used in the transaction that adds it, and the migrator runs as one transaction.
    uniqueIndex('notifications_dated_once_idx')
      .on(t.userId, t.channel, t.type, t.digestDate)
      .where(sql`digest_date is not null`),
    // Each delivery of a reminder once per channel (F5, D119): a snoozed reminder is a new delivery.
    uniqueIndex('notifications_reminder_once_idx')
      .on(t.userId, t.channel, sql`(payload->>'reminderId')`, sql`(payload->>'delivery')`)
      .where(sql`(payload->>'reminderId') is not null`),
    index('notifications_user_idx').on(t.userId, t.createdAt.desc()),
    index('notifications_pending_idx')
      .on(t.status)
      .where(sql`status = 'PENDING'`),
    ownerPolicy('notifications'),
  ],
).enableRLS();

// ── reminders (F5, D119) ──────────────────────────────────────────────────────
// Planned from the tracker each tick; `idempotency_key` (user, job, kind, anchor) makes planning
// safe to repeat, and the status flip PENDING → SENT in the delivery transaction makes sending
// safe to repeat. Delivery goes through `notifications`, so the existing dispatcher sends it.
export const reminders = pgTable(
  'reminders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    kind: reminderKindEnum('kind').notNull(),
    anchor: text('anchor').notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    status: reminderStatusEnum('status').notNull().default('PENDING'),
    deliveries: integer('deliveries').notNull().default(0),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    cancelledReason: text('cancelled_reason'),
    ...timestamps,
  },
  (t) => [
    index('reminders_due_idx')
      .on(t.dueAt)
      .where(sql`status = 'PENDING'`),
    index('reminders_user_idx').on(t.userId, t.status),
    ownerPolicy('reminders'),
  ],
).enableRLS();
