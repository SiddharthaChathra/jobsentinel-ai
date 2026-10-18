import { FRESHER_SCORE, SCAN_INTERVAL_SEC } from '@jobsentinel/config';
import type { FresherBand } from '@jobsentinel/types';

/** What the score is computed from: one company's classified postings in the window. */
export interface FresherAggregate {
  postingsSeen: number;
  fresherCount: number;
  /** Σ 0.5^(age/30) over every posting. */
  weightedAll: number;
  /** The same sum over fresher-eligible postings only. */
  weightedFresher: number;
  /** Days since the newest fresher-eligible posting; null when there is none. */
  daysSinceLastFresher: number | null;
}

export interface FresherScore {
  /** 0-100, or null when the sample is too small to judge (UNKNOWN). */
  score: number | null;
  band: FresherBand;
}

const DAY_MS = 86_400_000;

/** A posting's weight: 1 today, halving every `shareHalfLifeDays` (F4, docs/sources.md). */
export function postingWeight(ageDays: number): number {
  return 0.5 ** (Math.max(0, ageDays) / FRESHER_SCORE.shareHalfLifeDays);
}

/**
 * Builds the aggregate from individual postings — the same sums the worker computes in SQL
 * (`CompanyFresherService`), so tests can state the formula on plain fixtures.
 */
export function aggregatePostings(
  postings: { at: Date; fresher: boolean }[],
  now: Date,
): FresherAggregate {
  const agg: FresherAggregate = {
    postingsSeen: 0,
    fresherCount: 0,
    weightedAll: 0,
    weightedFresher: 0,
    daysSinceLastFresher: null,
  };
  for (const p of postings) {
    const age = (now.getTime() - p.at.getTime()) / DAY_MS;
    if (age > FRESHER_SCORE.windowDays) continue;
    const w = postingWeight(age);
    agg.postingsSeen += 1;
    agg.weightedAll += w;
    if (p.fresher) {
      agg.fresherCount += 1;
      agg.weightedFresher += w;
      agg.daysSinceLastFresher =
        agg.daysSinceLastFresher === null ? age : Math.min(agg.daysSinceLastFresher, age);
    }
  }
  return agg;
}

/**
 * Company "accepts freshers" score (F4, D118):
 *   score = round(100 × S × R)
 *   S = Σ_fresher w / Σ_all w        recency-weighted share of fresher postings, w = 0.5^(age/30)
 *   R = 0.5^(days since last fresher posting / 90)
 * Fewer than 5 postings in the window is UNKNOWN (neutral, score null). No fresher posting is 0.
 * Bands: HIGH ≥ 30 (badge), MEDIUM ≥ 10, LOW below.
 */
export function fresherScore(agg: FresherAggregate): FresherScore {
  if (agg.postingsSeen < FRESHER_SCORE.minPostings || agg.weightedAll <= 0) {
    return { score: null, band: 'UNKNOWN' };
  }
  if (agg.fresherCount === 0 || agg.daysSinceLastFresher === null) {
    return { score: 0, band: 'LOW' };
  }
  const share = Math.min(1, agg.weightedFresher / agg.weightedAll);
  const recency =
    0.5 ** (Math.max(0, agg.daysSinceLastFresher) / FRESHER_SCORE.recencyHalfLifeDays);
  const score = Math.round(100 * share * recency);
  const band: FresherBand =
    score >= FRESHER_SCORE.highMin ? 'HIGH' : score >= FRESHER_SCORE.mediumMin ? 'MEDIUM' : 'LOW';
  return { score, band };
}

/**
 * A company board's scan interval after a successful scan: the band's factor on its usual
 * interval, but never below the adapter's floor — the score can only move a board within the
 * limits it already had (F4). Keyword sources (no single company) keep their interval.
 */
export function boardIntervalSec(opts: {
  configuredSec: number | null;
  priority: keyof typeof SCAN_INTERVAL_SEC;
  floorSec: number;
  band: FresherBand | null;
}): number {
  const base = opts.configuredSec ?? SCAN_INTERVAL_SEC[opts.priority];
  const factor = opts.band ? FRESHER_SCORE.intervalFactor[opts.band] : 1;
  return Math.max(Math.round(base * factor), opts.floorSec);
}
