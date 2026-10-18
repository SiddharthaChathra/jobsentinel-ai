import {
  decideNotification,
  localDateKey,
  localParts,
  quietWindowEnd,
  utcForLocalHour,
  type NotifyCandidate,
  type NotifySettings,
} from './decide';

const IST = 'Asia/Kolkata';

const settings = (over: Partial<NotifySettings> = {}): NotifySettings => ({
  mode: 'BOTH',
  instantMinScore: 75,
  quietHoursStart: null,
  quietHoursEnd: null,
  includeNeedsReviewInDigest: true,
  telegramEnabled: true,
  pausedUntil: null,
  timezone: IST,
  ...over,
});

const job = (over: Partial<NotifyCandidate> = {}): NotifyCandidate => ({
  overallScore: 90,
  priority: 'VERY_HIGH',
  validationStatus: 'VALID',
  firstSeenAt: new Date('2026-09-22T10:00:00Z'),
  fresherEligible: true,
  ...over,
});

// 15:30 IST — comfortably outside any quiet window used below.
const now = new Date('2026-09-22T10:00:00Z');

describe('decideNotification', () => {
  it('sends an instant alert for a fresh, high-scoring, verified job', () => {
    const d = decideNotification(settings(), job(), now);
    expect(d).toMatchObject({ action: 'INSTANT', sendAfter: null });
  });

  it('sends nothing when notifications are disabled or paused', () => {
    expect(decideNotification(settings({ mode: 'DISABLED' }), job(), now).action).toBe('NONE');
    const paused = settings({ pausedUntil: new Date('2026-09-23T00:00:00Z') });
    expect(decideNotification(paused, job(), now).action).toBe('NONE');
    // A pause that has expired does not suppress anything.
    const expired = settings({ pausedUntil: new Date('2026-09-21T00:00:00Z') });
    expect(decideNotification(expired, job(), now).action).toBe('INSTANT');
  });

  it('never pushes a job whose legitimacy is unconfirmed', () => {
    for (const status of ['NEEDS_REVIEW', 'SUSPICIOUS'] as const) {
      const d = decideNotification(settings(), job({ validationStatus: status }), now);
      expect(d.action).toBe('DIGEST'); // summarised, never an instant alert
    }
    const optedOut = settings({ includeNeedsReviewInDigest: false });
    expect(
      decideNotification(optedOut, job({ validationStatus: 'NEEDS_REVIEW' }), now).action,
    ).toBe('NONE');
  });

  it('never notifies about an expired, invalid or unvalidated job', () => {
    // 'REJECTED' is a job status, not a validation status — the validation enum's failure value
    // is 'INVALID'.
    for (const status of ['EXPIRED', 'INVALID', 'PENDING'] as const) {
      expect(decideNotification(settings(), job({ validationStatus: status }), now).action).toBe(
        'NONE',
      );
    }
  });

  it('demotes a low score to the digest rather than dropping it', () => {
    const d = decideNotification(settings(), job({ overallScore: 60 }), now);
    expect(d).toMatchObject({ action: 'DIGEST' });
    expect(d.reason).toContain('below 75');
  });

  it('demotes a job that is no longer a new discovery', () => {
    const old = job({ firstSeenAt: new Date('2026-09-19T10:00:00Z') }); // 72 h earlier
    expect(decideNotification(settings(), old, now).action).toBe('DIGEST');
  });

  it('honours digest-only mode even for a perfect match', () => {
    const d = decideNotification(settings({ mode: 'DIGEST' }), job({ overallScore: 100 }), now);
    expect(d.action).toBe('DIGEST');
  });

  it('delays an alert during quiet hours instead of cancelling it', () => {
    // 22:00 IST = 16:30 UTC, inside a 22 → 07 window.
    const night = new Date('2026-09-22T17:00:00Z');
    const d = decideNotification(
      settings({ quietHoursStart: 22, quietHoursEnd: 7 }),
      job({ firstSeenAt: night }),
      night,
    );
    expect(d.action).toBe('INSTANT');
    if (d.action !== 'INSTANT' || !d.sendAfter) throw new Error('expected a delayed instant');
    expect(localParts(d.sendAfter, IST).hour).toBe(7);
    expect(d.sendAfter.getTime()).toBeGreaterThan(night.getTime());
  });
});

describe('quietWindowEnd', () => {
  const tz = { timezone: IST };

  it('returns null outside the window and when unset', () => {
    const noon = new Date('2026-09-22T06:30:00Z'); // 12:00 IST
    expect(quietWindowEnd({ ...tz, quietHoursStart: 22, quietHoursEnd: 7 }, noon)).toBeNull();
    expect(quietWindowEnd({ ...tz, quietHoursStart: null, quietHoursEnd: null }, noon)).toBeNull();
    expect(quietWindowEnd({ ...tz, quietHoursStart: 9, quietHoursEnd: 9 }, noon)).toBeNull();
  });

  it('handles a window that crosses midnight from both sides', () => {
    const lateEvening = new Date('2026-09-22T17:00:00Z'); // 22:30 IST, after start
    const earlyMorning = new Date('2026-09-22T23:00:00Z'); // 04:30 IST next day, before end
    for (const at of [lateEvening, earlyMorning]) {
      const end = quietWindowEnd({ ...tz, quietHoursStart: 22, quietHoursEnd: 7 }, at);
      expect(end).not.toBeNull();
      expect(localParts(end!, IST).hour).toBe(7);
      expect(end!.getTime()).toBeGreaterThan(at.getTime());
    }
  });

  it('handles a same-day window', () => {
    const at = new Date('2026-09-22T06:30:00Z'); // 12:00 IST
    const end = quietWindowEnd({ ...tz, quietHoursStart: 9, quietHoursEnd: 18 }, at);
    expect(localParts(end!, IST).hour).toBe(18);
  });
});

describe('local time helpers', () => {
  it('reports the local hour and day for a zone', () => {
    // 2026-09-22T20:00Z is 01:30 IST on the 23rd.
    const p = localParts(new Date('2026-09-22T20:00:00Z'), IST);
    expect(p).toMatchObject({ hour: 1, day: 23, month: 9, year: 2026 });
    expect(localDateKey(new Date('2026-09-22T20:00:00Z'), IST)).toBe('2026-09-23');
    expect(localDateKey(new Date('2026-09-22T20:00:00Z'), 'UTC')).toBe('2026-09-22');
  });

  it('resolves a local hour to the right UTC instant', () => {
    const at = utcForLocalHour(new Date('2026-09-22T10:00:00Z'), IST, 8);
    expect(localParts(at, IST).hour).toBe(8);
    // Across a DST boundary in a zone that observes it, the local hour still holds.
    const ny = utcForLocalHour(new Date('2026-11-02T12:00:00Z'), 'America/New_York', 8);
    expect(localParts(ny, 'America/New_York').hour).toBe(8);
  });
});

describe('an unresolved fresher verdict never becomes an instant alert', () => {
  it('sends a job with unknown fresher eligibility to the digest instead', () => {
    // `fresherEligible: null` means the rules and the AI both declined to commit. Pushing that to
    // Telegram as a "NEW FRESHER JOB" would state something we do not know (docs 10 §3).
    const decision = decideNotification(settings(), job({ fresherEligible: null }), now);
    expect(decision.action).toBe('DIGEST');
  });

  it('still sends a confirmed fresher job instantly', () => {
    const decision = decideNotification(settings(), job({ fresherEligible: true }), now);
    expect(decision.action).toBe('INSTANT');
  });
});

describe('utcForLocalHour: exact to the minute (regression, F5)', () => {
  it('India (UTC+5:30): 07:00 IST is 01:30 UTC, not 02:00', () => {
    expect(utcForLocalHour(new Date('2026-10-19T20:00:00Z'), 'Asia/Kolkata', 7)).toEqual(
      new Date('2026-10-20T01:30:00Z'),
    );
  });

  it('quiet hours 22-7 in India end at 07:00 IST exactly', () => {
    const end = quietWindowEnd(
      { quietHoursStart: 22, quietHoursEnd: 7, timezone: 'Asia/Kolkata' },
      new Date('2026-10-19T17:00:00Z'), // 22:30 IST
    );
    expect(end).toEqual(new Date('2026-10-20T01:30:00Z'));
  });

  it('across a DST change (London, 25 Oct 2026): 08:00 local is 08:00 UTC after it, 07:00 UTC before', () => {
    expect(utcForLocalHour(new Date('2026-10-24T12:00:00Z'), 'Europe/London', 8)).toEqual(
      new Date('2026-10-24T07:00:00Z'),
    );
    expect(utcForLocalHour(new Date('2026-10-25T12:00:00Z'), 'Europe/London', 8)).toEqual(
      new Date('2026-10-25T08:00:00Z'),
    );
  });
});
