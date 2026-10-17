/**
 * A provider's published request quota, checked before a scan starts (F3, D108). Adzuna's terms:
 * 25 hits/minute, 250/day, 1,000/week, 2,500/month — and "may vary these from time to time", so
 * the numbers are configuration. Windows are rolling (last 60 s / 24 h / 7 d / 30 d): stricter than
 * any calendar boundary the provider might use, so we can never be over by their count.
 */
export interface QuotaLimits {
  perMinute: number;
  perDay: number;
  perWeek: number;
  perMonth: number;
}

export type QuotaWindow = keyof QuotaLimits;

const WINDOW_MS: Record<QuotaWindow, number> = {
  perMinute: 60_000,
  perDay: 86_400_000,
  perWeek: 7 * 86_400_000,
  perMonth: 30 * 86_400_000,
};

export const QUOTA_WINDOWS = Object.keys(WINDOW_MS) as QuotaWindow[];

export function windowStart(window: QuotaWindow, now: Date): Date {
  return new Date(now.getTime() - WINDOW_MS[window]);
}

export type QuotaDecision =
  | { allowed: true }
  | { allowed: false; window: QuotaWindow; used: number; cap: number; retryAfterMs: number };

/**
 * Allowed only if, in every window, the requests already made plus the most one scan can make
 * stay within `safety` × the limit. Otherwise: which window would overflow, and how long until
 * it frees up enough (at most the window's length — a conservative estimate).
 */
export function checkQuota(
  used: Record<QuotaWindow, number>,
  limits: QuotaLimits,
  maxRequestsPerScan: number,
  safety = 0.9,
): QuotaDecision {
  for (const window of QUOTA_WINDOWS) {
    const cap = Math.floor(limits[window] * safety);
    if (used[window] + maxRequestsPerScan > cap) {
      return { allowed: false, window, used: used[window], cap, retryAfterMs: WINDOW_MS[window] };
    }
  }
  return { allowed: true };
}
