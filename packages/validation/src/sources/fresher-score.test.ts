import { aggregatePostings, boardIntervalSec, fresherScore, postingWeight } from './fresher-score';

const NOW = new Date('2026-10-18T00:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const postings = (spec: [ageDays: number, fresher: boolean][]) =>
  spec.map(([d, fresher]) => ({ at: daysAgo(d), fresher }));

describe('company fresher score (F4, D118)', () => {
  it('weights a posting 1 today, ½ at 30 days, ¼ at 60', () => {
    expect(postingWeight(0)).toBe(1);
    expect(postingWeight(30)).toBeCloseTo(0.5);
    expect(postingWeight(60)).toBeCloseTo(0.25);
  });

  it('is UNKNOWN (neutral, no score) below 5 postings, even if every one is a fresher role', () => {
    const agg = aggregatePostings(
      postings([
        [0, true],
        [1, true],
        [2, true],
        [3, true],
      ]),
      NOW,
    );
    expect(fresherScore(agg)).toEqual({ score: null, band: 'UNKNOWN' });
  });

  it('ignores postings older than the 365-day window when counting the sample', () => {
    const agg = aggregatePostings(
      postings([
        [0, true],
        [1, false],
        [2, false],
        [3, false],
        [400, true],
        [500, true],
      ]),
      NOW,
    );
    expect(agg.postingsSeen).toBe(4);
    expect(fresherScore(agg).band).toBe('UNKNOWN');
  });

  it('scores 100 when every recent posting is a fresher role, posted today', () => {
    const agg = aggregatePostings(
      postings([
        [0, true],
        [0, true],
        [0, true],
        [0, true],
        [0, true],
      ]),
      NOW,
    );
    expect(fresherScore(agg)).toEqual({ score: 100, band: 'HIGH' });
  });

  it('scores 0 (LOW) with enough postings and no fresher role', () => {
    const agg = aggregatePostings(
      postings([
        [0, false],
        [5, false],
        [9, false],
        [20, false],
        [40, false],
      ]),
      NOW,
    );
    expect(fresherScore(agg)).toEqual({ score: 0, band: 'LOW' });
  });

  it('matches the documented formula on a worked example (docs/sources.md)', () => {
    // 2 fresher postings (today, 30 days ago) and 4 others (today, 30, 60, 90 days ago).
    // Σall = 1 + .5 + 1 + .5 + .25 + .125 = 3.375; Σfresher = 1.5; S = .4444; R = 1 → 44.
    const agg = aggregatePostings(
      postings([
        [0, true],
        [30, true],
        [0, false],
        [30, false],
        [60, false],
        [90, false],
      ]),
      NOW,
    );
    expect(agg.weightedAll).toBeCloseTo(3.375);
    expect(agg.weightedFresher).toBeCloseTo(1.5);
    expect(fresherScore(agg)).toEqual({ score: 44, band: 'HIGH' });
  });

  it('decays with time since the last fresher posting: same share, 90 days later, halves', () => {
    const fresh = fresherScore(
      aggregatePostings(
        postings([
          [0, true],
          [0, false],
          [0, false],
          [0, false],
          [0, false],
        ]),
        NOW,
      ),
    );
    const stale = fresherScore(
      aggregatePostings(
        postings([
          [90, true],
          [90, false],
          [90, false],
          [90, false],
          [90, false],
        ]),
        NOW,
      ),
    );
    expect(fresh.score).toBe(20);
    expect(stale.score).toBe(10);
    expect(fresh.band).toBe('MEDIUM');
  });

  it('a recent fresher posting outweighs old non-fresher ones', () => {
    const recent = fresherScore(
      aggregatePostings(
        postings([
          [0, true],
          [120, false],
          [120, false],
          [120, false],
          [120, false],
        ]),
        NOW,
      ),
    );
    // S = 1 / (1 + 4 × 0.0625) = 0.8 → 80
    expect(recent).toEqual({ score: 80, band: 'HIGH' });
  });

  it('band edges: 30 is HIGH, 29 MEDIUM, 10 MEDIUM, 9 LOW', () => {
    const at = (share: number) =>
      fresherScore({
        postingsSeen: 10,
        fresherCount: 1,
        weightedAll: 1,
        weightedFresher: share,
        daysSinceLastFresher: 0,
      });
    expect(at(0.3).band).toBe('HIGH');
    expect(at(0.29).band).toBe('MEDIUM');
    expect(at(0.1).band).toBe('MEDIUM');
    expect(at(0.09).band).toBe('LOW');
  });
});

describe('board scan interval from the band (F4)', () => {
  const base = { configuredSec: null, priority: 'NORMAL' as const, floorSec: 0 };

  it('HIGH scans twice as often, LOW half as often, MEDIUM/UNKNOWN/no stats unchanged', () => {
    expect(boardIntervalSec({ ...base, band: 'HIGH' })).toBe(900);
    expect(boardIntervalSec({ ...base, band: 'MEDIUM' })).toBe(1800);
    expect(boardIntervalSec({ ...base, band: 'UNKNOWN' })).toBe(1800);
    expect(boardIntervalSec({ ...base, band: null })).toBe(1800);
    expect(boardIntervalSec({ ...base, band: 'LOW' })).toBe(3600);
  });

  it('never goes below the adapter floor, however high the score', () => {
    expect(boardIntervalSec({ ...base, floorSec: 1800, band: 'HIGH' })).toBe(1800);
    expect(
      boardIntervalSec({ configuredSec: 21_600, priority: 'LOW', floorSec: 21_600, band: 'HIGH' }),
    ).toBe(21_600);
  });

  it('starts from the configured interval when one is set', () => {
    expect(boardIntervalSec({ ...base, configuredSec: 7200, band: 'LOW' })).toBe(14_400);
  });
});
