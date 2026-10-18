/** Scan intervals (seconds) per source priority — see docs/architecture/07-scheduler-and-recovery.md */
export const SCAN_INTERVAL_SEC = {
  HIGH: 10 * 60,
  NORMAL: 30 * 60,
  LOW: 60 * 60,
} as const;

/** Priority bands for match scores — see docs/architecture/09-ai.md §5 */
export const PRIORITY_BANDS = [
  { band: 'VERY_HIGH', min: 90 },
  { band: 'HIGH', min: 75 },
  { band: 'MEDIUM', min: 60 },
  { band: 'OTHER', min: 0 },
] as const;

/** Maximum resume upload size in bytes (5 MB). */
export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

export const APP_NAME = 'JobSentinel AI';

/**
 * Company "accepts freshers" score (F4, D118; formula in docs/sources.md). Used only to space a
 * company board's scans and to show a badge — never to reject a job.
 */
export const FRESHER_SCORE = {
  /** Fewer classified postings than this in the window: UNKNOWN (neutral). */
  minPostings: 5,
  /** Postings older than this are not counted. */
  windowDays: 365,
  /** A posting's weight halves every 30 days, so the share reflects recent hiring. */
  shareHalfLifeDays: 30,
  /** The score halves for every 90 days since the company's last fresher posting. */
  recencyHalfLifeDays: 90,
  /** Band thresholds on the 0-100 score. HIGH shows the "Hires freshers often" badge. */
  highMin: 30,
  mediumMin: 10,
  /** Scan-interval multiplier per band, applied to company boards only, never below the adapter's floor. */
  intervalFactor: { HIGH: 0.5, MEDIUM: 1, LOW: 2, UNKNOWN: 1 },
} as const;

/** Tracker reminders (F5, D119). */
export const REMINDERS = {
  /** Reminders never go out between these local hours (22:00-07:00), on top of the user's own quiet hours. */
  quietStartHour: 22,
  quietEndHour: 7,
  followUpDays: { default: 7, min: 3, max: 14 },
  /** The "morning of" reminder goes out at this local hour, or at quiet end for an early interview. */
  morningHour: 8,
  /** A time-bound reminder (interview, deadline) first planned this long after its time is not sent: it would arrive too late to help. */
  staleAfterMs: 60 * 60_000,
  defaultSnoozeHours: 24,
} as const;
