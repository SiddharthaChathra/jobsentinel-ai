import type { WorkerHealthResponse } from '@jobsentinel/types';
import { utcForLocalHour } from '@jobsentinel/validation';
import { withinAwakeHours } from './keep-awake.service';

/**
 * Whether the worker is alive (F11, D124). Unhealthy when no heartbeat for 2× the dispatch
 * interval — but only inside the active hours, and measured from when the window opened if that
 * is later than the last beat: overnight the API sleeps and dispatches nothing (D99), so the
 * morning's first check must not count the planned overnight gap as an outage.
 */
export function workerHealth(opts: {
  lastBeatAt: Date | null;
  now: Date;
  intervalMin: number;
  hours: string;
  tz: string;
}): WorkerHealthResponse {
  const thresholdMin = 2 * opts.intervalMin;
  const base = {
    lastBeatAt: opts.lastBeatAt?.toISOString() ?? null,
    thresholdMin,
    activeHours: `${opts.hours} ${opts.tz}`,
  };
  if (!withinAwakeHours(opts.now, opts.hours, opts.tz)) {
    return { ...base, status: 'outside_active_hours', ageMin: null };
  }
  const opened = windowOpenedAt(opts.now, opts.hours, opts.tz);
  const since = Math.max(opts.lastBeatAt?.getTime() ?? 0, opened?.getTime() ?? 0);
  // Never beaten and an all-day window: nothing to measure from but the beat itself.
  const ageMin = since === 0 ? null : (opts.now.getTime() - since) / 60_000;
  const healthy = ageMin !== null && ageMin <= thresholdMin;
  return {
    ...base,
    status: healthy ? 'ok' : 'unhealthy',
    ageMin: ageMin === null ? null : Math.round(ageMin),
  };
}

/** When today's active window opened; null for an all-day window ("0-24"), which never reopens. */
export function windowOpenedAt(now: Date, hours: string, tz: string): Date | null {
  const [start, end] = hours.split('-').map(Number) as [number, number];
  if (start === 0 && end === 24) return null;
  const today = utcForLocalHour(now, tz, start);
  // A window that wraps past midnight ("22-6") and is open after midnight opened yesterday.
  return today > now ? utcForLocalHour(now, tz, start, -1) : today;
}
