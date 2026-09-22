import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
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
    ...timestamps,
  },
  () => [ownerPolicy('notification_settings')],
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
    index('notifications_user_idx').on(t.userId, t.createdAt.desc()),
    index('notifications_pending_idx')
      .on(t.status)
      .where(sql`status = 'PENDING'`),
    ownerPolicy('notifications'),
  ],
).enableRLS();
