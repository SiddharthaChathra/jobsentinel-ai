import { z } from 'zod';
import type { NotificationChannel, NotificationStatus, NotificationType } from '../enums';
import { NotificationMode } from '../enums';

/** Notification preferences — docs/architecture/10-notifications.md §6. */
export const NotificationSettingsInput = z.object({
  mode: NotificationMode.optional(),
  digestHourLocal: z.number().int().min(0).max(23).optional(),
  quietHoursStart: z.number().int().min(0).max(23).nullable().optional(),
  quietHoursEnd: z.number().int().min(0).max(23).nullable().optional(),
  instantMinScore: z.number().int().min(0).max(100).optional(),
  includeNeedsReviewInDigest: z.boolean().optional(),
  telegramEnabled: z.boolean().optional(),
  /** ISO instant to mute until; null resumes immediately. */
  pausedUntil: z.iso.datetime().nullable().optional(),
  /** Tracker reminders on/off (F5, D119). */
  remindersEnabled: z.boolean().optional(),
  /** Days with no status change after applying before a follow-up reminder (3-14, default 7). */
  followUpDays: z.number().int().min(3).max(14).optional(),
  /** Weekly Telegram summary, Sunday 09:00 in the user's timezone (F6); opt-in. */
  weeklySummaryEnabled: z.boolean().optional(),
});
export type NotificationSettingsInput = z.infer<typeof NotificationSettingsInput>;

export interface NotificationSettings {
  mode: NotificationMode;
  digestHourLocal: number;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  instantMinScore: number;
  includeNeedsReviewInDigest: boolean;
  telegramEnabled: boolean;
  pausedUntil: string | null;
  /** F5/F6 additions; optional for older clients. */
  remindersEnabled?: boolean;
  followUpDays?: number;
  weeklySummaryEnabled?: boolean;
  telegram: TelegramLinkState;
}

export interface TelegramLinkState {
  /** False when the server has no bot token — the UI should say so rather than offer linking. */
  available: boolean;
  linked: boolean;
  username: string | null;
  linkedAt: string | null;
}

export interface TelegramLinkStart {
  /** `https://t.me/<bot>?start=<code>` — open or render as a QR. */
  url: string;
  code: string;
  expiresAt: string;
}

export const InboxQuery = z.object({
  unreadOnly: z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : v === 'true' || v === '1' || v === true),
    z.boolean().optional(),
  ),
  cursor: z.string().max(200).optional(),
  limit: z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : Number(v)),
    z.number().int().min(1).max(100).optional(),
  ),
});
export type InboxQuery = z.infer<typeof InboxQuery>;

export interface InboxItem {
  id: string;
  type: NotificationType;
  channel: NotificationChannel;
  status: NotificationStatus;
  jobId: string | null;
  /** Rendered headline and body, ready to show — the API does the formatting, not the UI. */
  title: string;
  body: string;
  score: number | null;
  readAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface InboxSummary {
  unread: number;
}
