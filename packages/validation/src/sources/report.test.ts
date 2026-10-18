import {
  type CollectedJob,
  decideAutoPause,
  isIndiaScopedSource,
  filterReasonBucket,
  jobOutcome,
  sourceHealth,
  tally,
} from './report';

const now = new Date('2026-10-17T12:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

const listed = (over: Partial<CollectedJob> = {}): CollectedJob => ({
  status: 'VALID',
  validationStatus: 'VALID',
  closed: false,
  postedOrSeenAt: daysAgo(3),
  experienceLevel: 'FRESHER',
  experienceMinYears: 0,
  filterReason: null,
  ...over,
});
const filtered = (reason: string) => listed({ status: 'FILTERED_OUT', filterReason: reason });

describe('filterReasonBucket', () => {
  it.each([
    ['location outside India (United States)', 'LOCATION'],
    ['category not monitored', 'CATEGORY'],
    ['targets the 2025 batch', 'BATCH'],
    ['asks for 3+ years', 'EXPERIENCE'],
    ['experienced role', 'EXPERIENCE'],
    ['experience unknown (no AI verdict)', 'EXPERIENCE'],
    ['something new', 'OTHER'],
  ] as const)('%s -> %s', (reason, bucket) => {
    expect(filterReasonBucket(reason)).toBe(bucket);
  });
});

describe('placeholders on the report card (D117)', () => {
  const placeholder = listed({ status: 'PLACEHOLDER', experienceLevel: 'UNKNOWN' });

  it('never counts a placeholder as collected, kept or rejected — only as skipped', () => {
    const t = tally([listed(), placeholder, placeholder, filtered('category not monitored')], now);
    expect(t).toMatchObject({ collected: 2, kept: 1, placeholders: 2 });
    expect(Object.values(t.rejected).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('a source that found only placeholders collected nothing, so it is not "kept zero"', () => {
    expect(sourceHealth('ACTIVE', tally([placeholder, placeholder], now))).toBe(
      'COLLECTED_NOTHING',
    );
  });
});

describe('jobOutcome (kept = passes every gate)', () => {
  it('keeps a listed, valid, recent fresher job (0 to any years)', () => {
    expect(jobOutcome(listed(), now)).toEqual({ kept: true });
    expect(jobOutcome(listed({ experienceMinYears: 0, experienceLevel: 'UNKNOWN' }), now)).toEqual({
      kept: true,
    });
  });

  it.each([
    ['filtered on location', filtered('location outside India (Germany)'), 'LOCATION'],
    ['still in the pipeline', listed({ status: 'DISCOVERED' }), 'PENDING'],
    ['closed', listed({ closed: true }), 'EXPIRED'],
    [
      'not validated',
      listed({ status: 'NEEDS_REVIEW', validationStatus: 'NEEDS_REVIEW' }),
      'VALIDATION',
    ],
    [
      'asks a 2-year minimum',
      listed({ experienceMinYears: 2, experienceLevel: 'ENTRY_LEVEL' }),
      'EXPERIENCE',
    ],
    ['older than 60 days', listed({ postedOrSeenAt: daysAgo(61) }), 'STALE'],
  ] as const)('rejects a job %s', (_label, job, reason) => {
    expect(jobOutcome(job, now)).toEqual({ kept: false, reason });
  });
});

describe('sourceHealth keeps the three cases apart', () => {
  it('errors, collected nothing, kept zero and OK are distinct', () => {
    expect(sourceHealth('FAILING', tally([filtered('category not monitored')], now))).toBe(
      'ERRORS',
    );
    expect(sourceHealth('ACTIVE', tally([], now))).toBe('COLLECTED_NOTHING');
    expect(sourceHealth('ACTIVE', tally([filtered('category not monitored')], now))).toBe(
      'KEPT_ZERO',
    );
    expect(sourceHealth('ACTIVE', tally([listed()], now))).toBe('OK');
    expect(sourceHealth('PAUSED_AUTO', tally([], now))).toBe('PAUSED');
  });

  it('does not call a source kept-zero while its jobs are still in the pipeline', () => {
    expect(sourceHealth('ACTIVE', tally([listed({ status: 'DISCOVERED' })], now))).toBe('OK');
  });
});

describe('decideAutoPause (F2, D104)', () => {
  const old = daysAgo(90);
  const filteredMany = (n: number) =>
    tally(
      Array.from({ length: n }, (_, i) =>
        filtered(i % 3 === 0 ? 'category not monitored' : 'asks for 3+ years'),
      ),
      now,
    );
  const base = {
    status: 'ACTIVE' as const,
    createdAt: old,
    resumedAt: null,
    window: filteredMany(21),
    now,
    minCollected: 20,
    windowDays: 30,
    exempt: false,
  };

  it('pauses an old active source with 20+ collected jobs and none kept', () => {
    const d = decideAutoPause(base);
    expect(d).toEqual({
      action: 'PAUSE',
      reason: 'collected 21 jobs in 30 days and kept none (experience 14, category 7)',
    });
  });

  it('never pauses below the minimum sample — 19 collected is too few (spares tiny boards)', () => {
    expect(decideAutoPause({ ...base, window: filteredMany(19) })).toEqual({
      action: 'NONE',
      why: 'TOO_FEW',
    });
    expect(decideAutoPause({ ...base, window: filteredMany(20) }).action).toBe('PAUSE');
  });

  it('never pauses a source that collected nothing (possibly broken, needs a human)', () => {
    expect(decideAutoPause({ ...base, window: tally([], now) })).toEqual({
      action: 'NONE',
      why: 'TOO_FEW',
    });
  });

  it('alerts instead of pausing an India-scoped source', () => {
    expect(decideAutoPause({ ...base, exempt: true })).toEqual({
      action: 'ALERT',
      reason: 'collected 21 jobs in 30 days and kept none (experience 14, category 7)',
    });
  });

  it('uses the configured threshold and window, not hard-coded ones', () => {
    expect(decideAutoPause({ ...base, minCollected: 50 })).toEqual({
      action: 'NONE',
      why: 'TOO_FEW',
    });
    // A 60-day window: a 45-day-old source is still too new.
    expect(decideAutoPause({ ...base, windowDays: 60, createdAt: daysAgo(45) })).toEqual({
      action: 'NONE',
      why: 'TOO_NEW',
    });
    expect(decideAutoPause({ ...base, windowDays: 60 }).action).toBe('PAUSE');
  });

  it('never pauses a source in error backoff — that is the backoff’s job', () => {
    for (const status of ['DEGRADED', 'FAILING', 'DISABLED'] as const) {
      expect(decideAutoPause({ ...base, status })).toEqual({ action: 'NONE', why: 'NOT_ACTIVE' });
    }
  });

  it('exempts a source younger than the window, and one resumed within it', () => {
    expect(decideAutoPause({ ...base, createdAt: daysAgo(29) })).toEqual({
      action: 'NONE',
      why: 'TOO_NEW',
    });
    expect(decideAutoPause({ ...base, resumedAt: daysAgo(5) })).toEqual({
      action: 'NONE',
      why: 'TOO_NEW',
    });
  });

  it('keeps a source that kept even one job, and waits while jobs are pending', () => {
    const jobs = Array.from({ length: 25 }, () => filtered('category not monitored'));
    expect(decideAutoPause({ ...base, window: tally([...jobs, listed()], now) })).toEqual({
      action: 'NONE',
      why: 'KEEPS_JOBS',
    });
    expect(
      decideAutoPause({ ...base, window: tally([...jobs, listed({ status: 'CLASSIFIED' })], now) }),
    ).toEqual({ action: 'NONE', why: 'STILL_PENDING' });
  });

  it('does not pause an already paused source again', () => {
    expect(decideAutoPause({ ...base, status: 'PAUSED_AUTO' })).toEqual({
      action: 'NONE',
      why: 'NOT_ACTIVE',
    });
  });
});

describe('isIndiaScopedSource (D104)', () => {
  it('treats Adzuna India searches as India-scoped, including the default country', () => {
    expect(
      isIndiaScopedSource({ adapter: 'adzuna', config: { country: 'in', what: 'graduate' } }),
    ).toBe(true);
    expect(isIndiaScopedSource({ adapter: 'adzuna', config: { what: 'graduate' } })).toBe(true);
    expect(isIndiaScopedSource({ adapter: 'adzuna', config: { country: 'gb' } })).toBe(false);
  });

  it('honours an explicit flag on any source, and is false otherwise', () => {
    expect(isIndiaScopedSource({ adapter: 'greenhouse', config: { indiaScoped: true } })).toBe(
      true,
    );
    expect(isIndiaScopedSource({ adapter: 'greenhouse', config: { board: 'elastic' } })).toBe(
      false,
    );
    expect(isIndiaScopedSource({ adapter: 'lever', config: null })).toBe(false);
  });
});
