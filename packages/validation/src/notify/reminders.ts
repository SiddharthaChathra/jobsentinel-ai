import { REMINDERS } from '@jobsentinel/config';
import type { ApplicationStatus, ReminderKind } from '@jobsentinel/types';
import { localParts, quietWindowEnd, utcForLocalHour, type NotifySettings } from './decide';

const DAY_MS = 86_400_000;

/** What the planner needs to know about one job in one user's tracker. */
export interface ReminderInput {
  /** The job is in the user's saved list. */
  saved: boolean;
  /** Tracker status; null when there is no tracker row. */
  status: ApplicationStatus | null;
  lastStatusChangeAt: Date | null;
  /** The user's override of the automatic follow-up time. */
  followUpAt: Date | null;
  interviewAt: Date | null;
  /** The user's deadline, else the posting's. */
  deadline: Date | null;
  followUpDays: number;
  timezone: string;
}

export interface PlannedReminder {
  kind: ReminderKind;
  dueAt: Date;
  /**
   * What the reminder hangs on — the date it was computed from. Part of the idempotency key, so
   * a changed interview time or a new status change plans a new reminder and cancels the old one.
   */
  anchor: string;
}

/** Statuses after which nothing is worth reminding about. */
const CLOSED: ReadonlySet<ApplicationStatus> = new Set(['REJECTED', 'NOT_INTERESTED', 'SELECTED']);

/**
 * The reminders a tracker row should have right now (F5, D119). Pure: the service inserts the
 * missing ones (idempotent on `kind + anchor`) and cancels pending ones no longer in this list.
 *
 * - FOLLOW_UP: status APPLIED and no status change for `followUpDays` (3-14). One per stretch:
 *   the anchor is the last status change, so it fires once until the status moves again.
 * - INTERVIEW_DAY_BEFORE / INTERVIEW_MORNING: an interview date that is still ahead.
 * - DEADLINE_3D / DEADLINE_1D: saved, not applied (no tracker row, or VIEWED), deadline ahead.
 *
 * Moving to INTERVIEW drops the follow-up and the deadline reminders; REJECTED, SELECTED and
 * NOT_INTERESTED drop everything.
 */
export function planReminders(input: ReminderInput, now: Date): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  if (input.status !== null && CLOSED.has(input.status)) return out;

  if (input.status === 'APPLIED' && (input.followUpAt || input.lastStatusChangeAt)) {
    const days = clamp(input.followUpDays, REMINDERS.followUpDays.min, REMINDERS.followUpDays.max);
    out.push(
      input.followUpAt
        ? { kind: 'FOLLOW_UP', dueAt: input.followUpAt, anchor: `at:${iso(input.followUpAt)}` }
        : {
            kind: 'FOLLOW_UP',
            dueAt: new Date(input.lastStatusChangeAt!.getTime() + days * DAY_MS),
            anchor: `since:${iso(input.lastStatusChangeAt!)}`,
          },
    );
  }

  if (input.interviewAt && input.interviewAt > now) {
    const anchor = iso(input.interviewAt);
    out.push({
      kind: 'INTERVIEW_DAY_BEFORE',
      dueAt: new Date(input.interviewAt.getTime() - DAY_MS),
      anchor,
    });
    const morning = interviewMorning(input.interviewAt, input.timezone);
    if (morning < input.interviewAt)
      out.push({ kind: 'INTERVIEW_MORNING', dueAt: morning, anchor });
  }

  const notApplied = input.status === null || input.status === 'VIEWED';
  if (input.saved && notApplied && input.deadline && input.deadline > now) {
    const anchor = iso(input.deadline);
    out.push({
      kind: 'DEADLINE_3D',
      dueAt: new Date(input.deadline.getTime() - 3 * DAY_MS),
      anchor,
    });
    out.push({
      kind: 'DEADLINE_1D',
      dueAt: new Date(input.deadline.getTime() - DAY_MS),
      anchor,
    });
  }
  return out;
}

/**
 * The "morning of" an interview: 08:00 local on its day, or quiet end (07:00) when the
 * interview starts before 09:00, so the reminder still comes first.
 */
export function interviewMorning(interviewAt: Date, timezone: string): Date {
  const local = localParts(interviewAt, timezone);
  const hour =
    local.hour < REMINDERS.morningHour + 1 ? REMINDERS.quietEndHour : REMINDERS.morningHour;
  // utcForLocalHour takes the local calendar day of `interviewAt`, not its UTC day.
  return utcForLocalHour(interviewAt, timezone, hour);
}

/**
 * When a due reminder may go out (F5): never 22:00-07:00 in the user's timezone, nor in their
 * own quiet hours. Returns null when it may go now, else the instant the quiet time ends — a
 * reminder is deferred, never dropped.
 */
export function reminderQuietEnd(
  settings: Pick<NotifySettings, 'quietHoursStart' | 'quietHoursEnd' | 'timezone'>,
  now: Date,
): Date | null {
  const fixed = {
    quietHoursStart: REMINDERS.quietStartHour,
    quietHoursEnd: REMINDERS.quietEndHour,
    timezone: settings.timezone,
  };
  let at = now;
  let deferred = false;
  // The two windows may overlap or abut (e.g. the user's 21-23 next to 22-07): step until neither applies.
  for (let i = 0; i < 4; i++) {
    const end = quietWindowEnd(fixed, at) ?? quietWindowEnd(settings, at);
    if (!end) break;
    at = end;
    deferred = true;
  }
  return deferred ? at : null;
}

/** Whether a reminder planned for the first time should still be created. */
export function isStaleOnArrival(kind: ReminderKind, dueAt: Date, now: Date): boolean {
  // A late follow-up is still useful ("no update for 10 days"); a late interview or deadline
  // reminder is not — and a "3 days left" message with 2 days left would be wrong.
  if (kind === 'FOLLOW_UP') return false;
  return now.getTime() - dueAt.getTime() > REMINDERS.staleAfterMs;
}

/** Plain-language line for the inbox, Telegram and the Applications page. */
export function reminderMessage(
  kind: ReminderKind,
  ctx: { title: string; company: string; daysSinceChange?: number | null },
): string {
  const job = `${ctx.title} at ${ctx.company}`;
  switch (kind) {
    case 'FOLLOW_UP':
      return `Follow up on ${job}: no update${
        ctx.daysSinceChange ? ` for ${ctx.daysSinceChange} days` : ''
      } since you applied.`;
    case 'INTERVIEW_DAY_BEFORE':
      return `Interview tomorrow: ${job}.`;
    case 'INTERVIEW_MORNING':
      return `Interview today: ${job}. Good luck!`;
    case 'DEADLINE_3D':
      return `3 days left to apply: ${job}.`;
    case 'DEADLINE_1D':
      return `1 day left to apply: ${job}.`;
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

function iso(d: Date): string {
  return d.toISOString();
}
