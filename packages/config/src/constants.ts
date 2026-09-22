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
