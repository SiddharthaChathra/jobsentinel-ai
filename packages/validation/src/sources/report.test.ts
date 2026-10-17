import {
  type CollectedJob,
  decideAutoPause,
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

describe('decideAutoPause (F2)', () => {
  const old = daysAgo(90);
  const keptNone = tally(
    [
      filtered('category not monitored'),
      filtered('asks for 3+ years'),
      filtered('asks for 5+ years'),
    ],
    now,
  );

  it('pauses an old active source that collected jobs and kept none', () => {
    const d = decideAutoPause({
      status: 'ACTIVE',
      createdAt: old,
      resumedAt: null,
      last30: keptNone,
      now,
    });
    expect(d.pause).toBe(true);
    expect(d.pause && d.reason).toBe(
      'collected 3 jobs in 30 days and kept none (experience 2, category 1)',
    );
  });

  it('never pauses a source in error backoff — that is the backoff’s job', () => {
    for (const status of ['DEGRADED', 'FAILING', 'DISABLED'] as const) {
      expect(
        decideAutoPause({ status, createdAt: old, resumedAt: null, last30: keptNone, now }),
      ).toEqual({
        pause: false,
        why: 'NOT_ACTIVE',
      });
    }
  });

  it('never pauses a source that collected nothing (possibly broken, needs a human)', () => {
    expect(
      decideAutoPause({
        status: 'ACTIVE',
        createdAt: old,
        resumedAt: null,
        last30: tally([], now),
        now,
      }),
    ).toEqual({ pause: false, why: 'COLLECTED_NOTHING' });
  });

  it('exempts a source younger than 30 days, and one resumed within 30 days', () => {
    expect(
      decideAutoPause({
        status: 'ACTIVE',
        createdAt: daysAgo(29),
        resumedAt: null,
        last30: keptNone,
        now,
      }),
    ).toEqual({ pause: false, why: 'TOO_NEW' });
    expect(
      decideAutoPause({
        status: 'ACTIVE',
        createdAt: old,
        resumedAt: daysAgo(5),
        last30: keptNone,
        now,
      }),
    ).toEqual({ pause: false, why: 'TOO_NEW' });
  });

  it('keeps a source that kept even one job', () => {
    const one = tally([filtered('category not monitored'), listed()], now);
    expect(
      decideAutoPause({ status: 'ACTIVE', createdAt: old, resumedAt: null, last30: one, now }),
    ).toEqual({
      pause: false,
      why: 'KEEPS_JOBS',
    });
  });

  it('waits while collected jobs are still being processed', () => {
    const pending = tally(
      [filtered('category not monitored'), listed({ status: 'CLASSIFIED' })],
      now,
    );
    expect(
      decideAutoPause({ status: 'ACTIVE', createdAt: old, resumedAt: null, last30: pending, now }),
    ).toEqual({
      pause: false,
      why: 'STILL_PENDING',
    });
  });

  it('does not pause an already paused source again', () => {
    expect(
      decideAutoPause({
        status: 'PAUSED_AUTO',
        createdAt: old,
        resumedAt: null,
        last30: keptNone,
        now,
      }),
    ).toEqual({ pause: false, why: 'NOT_ACTIVE' });
  });
});
