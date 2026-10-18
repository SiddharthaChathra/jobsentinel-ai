import { WEEKLY_SUMMARY } from '@jobsentinel/config';
import { localDateKey, utcForLocalHour } from './decide';

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The local weekday of an instant, 0 = Sunday. */
export function localWeekday(at: Date, timezone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(
    at,
  );
  return WEEKDAYS.indexOf(name);
}

export interface WeeklyWindow {
  /** Within the send window: from Sunday 09:00 local to 24 hours later. */
  due: boolean;
  /** The Sunday's local date (`YYYY-MM-DD`): one summary per user, channel and key. */
  weekKey: string;
  /** The week the summary covers: the 7 days before Sunday 09:00. */
  from: Date;
  to: Date;
}

/**
 * When the weekly summary goes out (F6, D121): Sunday 09:00 in the user's timezone. The most
 * recent Sunday 09:00 at or before `now` anchors the week; the summary is due for 24 hours after
 * it, so an opt-in on Wednesday does not trigger a summary until the next Sunday.
 */
export function weeklySummaryWindow(now: Date, timezone: string): WeeklyWindow {
  const back = (localWeekday(now, timezone) - WEEKLY_SUMMARY.weekday + 7) % 7;
  let anchor = utcForLocalHour(now, timezone, WEEKLY_SUMMARY.hour, -back);
  // Sunday before 09:00: the anchor is still last Sunday.
  if (anchor > now) anchor = utcForLocalHour(now, timezone, WEEKLY_SUMMARY.hour, -7);
  return {
    due: now.getTime() - anchor.getTime() < WEEKLY_SUMMARY.graceMs,
    weekKey: localDateKey(anchor, timezone),
    from: new Date(anchor.getTime() - 7 * DAY_MS),
    to: anchor,
  };
}
