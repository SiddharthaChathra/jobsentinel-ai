import type { NotificationMode, PriorityBand, ValidationStatus } from '@jobsentinel/types';

/**
 * A job is only "new" for instant-alert purposes within this window (docs 10 §2). Instant alerts
 * are for fresh discoveries; anything older reaches the user through the digest instead.
 */
export const INSTANT_FRESHNESS_HOURS = 48;

export interface NotifySettings {
  mode: NotificationMode;
  instantMinScore: number;
  /** Local hour (0–23) the quiet window opens/closes; null disables quiet hours. */
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  includeNeedsReviewInDigest: boolean;
  telegramEnabled: boolean;
  pausedUntil: Date | null;
  /** IANA zone, used for quiet hours and the digest hour. */
  timezone: string;
}

export interface NotifyCandidate {
  overallScore: number;
  priority: PriorityBand;
  validationStatus: ValidationStatus;
  firstSeenAt: Date;
  fresherEligible: boolean | null;
}

export type NotifyDecision =
  | { action: 'INSTANT'; sendAfter: Date | null; reason: string }
  | { action: 'DIGEST'; reason: string }
  | { action: 'NONE'; reason: string };

/**
 * Decides how (or whether) a matched job reaches the user (docs 10 §2).
 *
 * Pure and deterministic: the dispatcher owns delivery, the unique index owns "never twice", and
 * this owns "never unwanted". A job that is not alerted is never lost — it is still in the
 * dashboard, and `DIGEST` means it will be summarised rather than pushed.
 */
export function decideNotification(
  settings: NotifySettings,
  job: NotifyCandidate,
  now: Date = new Date(),
): NotifyDecision {
  if (settings.mode === 'DISABLED') return { action: 'NONE', reason: 'notifications disabled' };
  if (settings.pausedUntil && settings.pausedUntil > now) {
    return { action: 'NONE', reason: `paused until ${settings.pausedUntil.toISOString()}` };
  }

  // A job we could not confirm is never pushed. It may be summarised, but only on request:
  // an unverified posting must never arrive looking like a vetted one (docs 08, 10 §2).
  if (job.validationStatus === 'NEEDS_REVIEW' || job.validationStatus === 'SUSPICIOUS') {
    return settings.includeNeedsReviewInDigest
      ? { action: 'DIGEST', reason: 'unconfirmed job, digest only' }
      : { action: 'NONE', reason: 'unconfirmed job and digest opted out' };
  }
  if (job.validationStatus !== 'VALID') {
    return { action: 'NONE', reason: `validation status ${job.validationStatus}` };
  }

  // Ambiguous/UNKNOWN classifications must default to EXCLUDED from instant Telegram notification.
  if (job.fresherEligible === null) {
    return { action: 'DIGEST', reason: 'ambiguous experience level, digest only' };
  }

  if (settings.mode === 'DIGEST') return { action: 'DIGEST', reason: 'digest-only mode' };

  if (job.overallScore < settings.instantMinScore) {
    return {
      action: 'DIGEST',
      reason: `score ${job.overallScore} below ${settings.instantMinScore}`,
    };
  }
  const ageHours = (now.getTime() - job.firstSeenAt.getTime()) / 3_600_000;
  if (ageHours > INSTANT_FRESHNESS_HOURS) {
    return { action: 'DIGEST', reason: `first seen ${Math.round(ageHours)} h ago` };
  }

  // Quiet hours delay the alert; they never cancel it.
  const quietEnd = quietWindowEnd(settings, now);
  return quietEnd
    ? { action: 'INSTANT', sendAfter: quietEnd, reason: 'queued until quiet hours end' }
    : { action: 'INSTANT', sendAfter: null, reason: `score ${job.overallScore}` };
}

/**
 * If `now` falls inside the user's quiet hours, returns the instant the window closes, in UTC.
 * Windows that cross midnight (e.g. 22 → 7) are handled.
 */
export function quietWindowEnd(
  settings: Pick<NotifySettings, 'quietHoursStart' | 'quietHoursEnd' | 'timezone'>,
  now: Date,
): Date | null {
  const { quietHoursStart: start, quietHoursEnd: end } = settings;
  if (start === null || end === null || start === end) return null;

  const local = localParts(now, settings.timezone);
  const crossesMidnight = start > end;
  const inQuiet = crossesMidnight
    ? local.hour >= start || local.hour < end
    : local.hour >= start && local.hour < end;
  if (!inQuiet) return null;

  // The window ends at `end` o'clock local time — today if we have not passed it, else tomorrow.
  const addDays = crossesMidnight && local.hour >= start ? 1 : 0;
  return utcForLocalHour(now, settings.timezone, end, addDays);
}

/** The user's local wall-clock hour and date for an instant. */
export function localParts(
  at: Date,
  timezone: string,
): { hour: number; year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  return {
    // Intl renders midnight as "24" in some environments.
    hour: Number(parts.hour) % 24,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

/** The user's local calendar day, as `YYYY-MM-DD` — the digest's idempotency key. */
export function localDateKey(at: Date, timezone: string): string {
  const { year, month, day } = localParts(at, timezone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The UTC instant at which a given local hour next occurs. Resolved by search rather than by
 * offset arithmetic, so DST transitions cannot produce an hour that does not exist locally.
 */
export function utcForLocalHour(
  from: Date,
  timezone: string,
  localHour: number,
  addDays = 0,
): Date {
  const base = new Date(from.getTime() + addDays * 86_400_000);
  const { year, month, day } = localParts(base, timezone);
  const wanted = Date.UTC(year, month - 1, day, localHour, 0, 0);
  // Start from the UTC guess, then subtract the zone's offset at that instant. The offset is
  // measured to the minute: correcting in whole hours left India (UTC+5:30) 30 minutes late,
  // so quiet hours ending at 07:00 released alerts at 07:30. A second pass settles DST edges.
  let guess = wanted;
  for (let i = 0; i < 2; i++) guess = wanted - offsetMs(new Date(guess), timezone);
  return new Date(guess);
}

/** The zone's offset from UTC at an instant, in milliseconds (IST: +5:30). */
function offsetMs(at: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, Number(x.value)]));
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day, p.hour! % 24, p.minute, p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Digest ordering: worst-to-best is never useful, so bands sort high first, then score. */
export const PRIORITY_ORDER: Record<PriorityBand, number> = {
  VERY_HIGH: 0,
  HIGH: 1,
  MEDIUM: 2,
  OTHER: 3,
};
