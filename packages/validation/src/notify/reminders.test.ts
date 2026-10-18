import {
  interviewMorning,
  isStaleOnArrival,
  planReminders,
  reminderMessage,
  reminderQuietEnd,
  type ReminderInput,
} from './reminders';

const IST = 'Asia/Kolkata';
const NOW = new Date('2026-10-18T06:00:00Z'); // 11:30 IST
const DAY = 86_400_000;

const base: ReminderInput = {
  saved: false,
  status: null,
  lastStatusChangeAt: null,
  followUpAt: null,
  interviewAt: null,
  deadline: null,
  followUpDays: 7,
  timezone: IST,
};
const kinds = (input: Partial<ReminderInput>) =>
  planReminders({ ...base, ...input }, NOW).map((r) => r.kind);

describe('planReminders (F5, D119)', () => {
  describe('follow-up', () => {
    it('APPLIED with no change: one follow-up N days after the last status change', () => {
      const changed = new Date('2026-10-10T10:00:00Z');
      const [r] = planReminders({ ...base, status: 'APPLIED', lastStatusChangeAt: changed }, NOW);
      expect(r).toEqual({
        kind: 'FOLLOW_UP',
        dueAt: new Date(changed.getTime() + 7 * DAY),
        anchor: `since:${changed.toISOString()}`,
      });
    });

    it('uses the configured days, clamped to 3-14', () => {
      const changed = new Date('2026-10-10T10:00:00Z');
      const due = (followUpDays: number) =>
        planReminders(
          { ...base, status: 'APPLIED', lastStatusChangeAt: changed, followUpDays },
          NOW,
        )[0]!.dueAt.getTime() - changed.getTime();
      expect(due(3)).toBe(3 * DAY);
      expect(due(14)).toBe(14 * DAY);
      expect(due(1)).toBe(3 * DAY);
      expect(due(30)).toBe(14 * DAY);
    });

    it('a new status change moves the anchor, so the old follow-up is no longer wanted', () => {
      const first = planReminders(
        { ...base, status: 'APPLIED', lastStatusChangeAt: new Date('2026-10-01T00:00:00Z') },
        NOW,
      )[0]!;
      const later = planReminders(
        { ...base, status: 'APPLIED', lastStatusChangeAt: new Date('2026-10-12T00:00:00Z') },
        NOW,
      )[0]!;
      expect(later.anchor).not.toBe(first.anchor);
    });

    it('a user-set follow-up time wins', () => {
      const at = new Date('2026-10-21T04:30:00Z');
      const [r] = planReminders(
        {
          ...base,
          status: 'APPLIED',
          lastStatusChangeAt: new Date('2026-10-10T00:00:00Z'),
          followUpAt: at,
        },
        NOW,
      );
      expect(r).toMatchObject({ kind: 'FOLLOW_UP', dueAt: at, anchor: `at:${at.toISOString()}` });
    });

    it('only for APPLIED: not for VIEWED, INTERVIEW or a closed application', () => {
      const changed = new Date('2026-10-10T00:00:00Z');
      for (const status of ['VIEWED', 'INTERVIEW', 'REJECTED', 'SELECTED'] as const) {
        expect(kinds({ status, lastStatusChangeAt: changed })).not.toContain('FOLLOW_UP');
      }
    });
  });

  describe('interview', () => {
    // 20 Oct, 10:00 IST = 04:30 UTC.
    const interviewAt = new Date('2026-10-20T04:30:00Z');

    it('the day before and the morning of (08:00 local)', () => {
      const out = planReminders({ ...base, status: 'INTERVIEW', interviewAt }, NOW);
      expect(out).toEqual([
        {
          kind: 'INTERVIEW_DAY_BEFORE',
          dueAt: new Date('2026-10-19T04:30:00Z'),
          anchor: interviewAt.toISOString(),
        },
        {
          kind: 'INTERVIEW_MORNING',
          dueAt: new Date('2026-10-20T02:30:00Z'), // 08:00 IST
          anchor: interviewAt.toISOString(),
        },
      ]);
    });

    it('an early interview (08:30 local) gets its morning reminder at 07:00', () => {
      expect(interviewMorning(new Date('2026-10-20T03:00:00Z'), IST)).toEqual(
        new Date('2026-10-20T01:30:00Z'),
      );
    });

    it('takes the local day, not the UTC day, across the IST/UTC date boundary', () => {
      // 20 Oct 08:00 IST is 02:30 UTC on the 20th; 19 Oct 23:00 UTC is already the 20th in IST.
      const lateUtc = new Date('2026-10-19T23:00:00Z'); // 04:30 IST on the 20th
      // Before 09:00 local → 07:00 IST on the 20th, which is after a 04:30 interview: no morning one.
      expect(
        planReminders({ ...base, status: 'INTERVIEW', interviewAt: lateUtc }, NOW).map(
          (r) => r.kind,
        ),
      ).toEqual(['INTERVIEW_DAY_BEFORE']);
      // In UTC the same interview would have its "morning" on the 19th — the planner must not do that.
      expect(interviewMorning(new Date('2026-10-20T06:00:00Z'), IST)).toEqual(
        new Date('2026-10-20T02:30:00Z'),
      );
    });

    it('nothing for a past interview, or once the application is closed', () => {
      expect(kinds({ status: 'INTERVIEW', interviewAt: new Date(NOW.getTime() - DAY) })).toEqual(
        [],
      );
      expect(kinds({ status: 'REJECTED', interviewAt })).toEqual([]);
    });
  });

  describe('deadline', () => {
    const deadline = new Date('2026-10-25T18:29:00Z');

    it('saved, not applied: 3 days and 1 day before', () => {
      const out = planReminders({ ...base, saved: true, deadline }, NOW);
      expect(out.map((r) => [r.kind, r.dueAt.toISOString()])).toEqual([
        ['DEADLINE_3D', '2026-10-22T18:29:00.000Z'],
        ['DEADLINE_1D', '2026-10-24T18:29:00.000Z'],
      ]);
    });

    it('also when the tracker row only says VIEWED', () => {
      expect(kinds({ saved: true, status: 'VIEWED', deadline })).toEqual([
        'DEADLINE_3D',
        'DEADLINE_1D',
      ]);
    });

    it('not when not saved, already applied, past the deadline, or no deadline', () => {
      expect(kinds({ deadline })).toEqual([]);
      expect(kinds({ saved: true, status: 'APPLIED', deadline })).not.toContain('DEADLINE_1D');
      expect(kinds({ saved: true, deadline: new Date(NOW.getTime() - 1000) })).toEqual([]);
      expect(kinds({ saved: true })).toEqual([]);
    });

    it('moving to INTERVIEW drops the deadline and follow-up reminders, keeps the interview ones', () => {
      const out = kinds({
        saved: true,
        status: 'INTERVIEW',
        deadline,
        lastStatusChangeAt: new Date('2026-10-01T00:00:00Z'),
        interviewAt: new Date('2026-10-20T04:30:00Z'),
      });
      expect(out).toEqual(['INTERVIEW_DAY_BEFORE', 'INTERVIEW_MORNING']);
    });
  });
});

describe('reminderQuietEnd: 22:00-07:00 in the user timezone, plus their own quiet hours', () => {
  const settings = { quietHoursStart: null, quietHoursEnd: null, timezone: IST };

  it('21:59 IST may send; 22:00 IST waits until 07:00 IST the next morning', () => {
    expect(reminderQuietEnd(settings, new Date('2026-10-19T16:29:00Z'))).toBeNull();
    // 22:30 IST on the 19th is 17:00 UTC; 07:00 IST on the 20th is 01:30 UTC.
    expect(reminderQuietEnd(settings, new Date('2026-10-19T17:00:00Z'))).toEqual(
      new Date('2026-10-20T01:30:00Z'),
    );
  });

  it('after midnight (01:00 UTC = 06:30 IST, same UTC day) waits until 07:00 IST that morning', () => {
    expect(reminderQuietEnd(settings, new Date('2026-10-20T01:00:00Z'))).toEqual(
      new Date('2026-10-20T01:30:00Z'),
    );
    expect(reminderQuietEnd(settings, new Date('2026-10-20T01:30:00Z'))).toBeNull();
  });

  it("the user's own quiet hours apply too, and chain with the fixed window", () => {
    const user = { quietHoursStart: 7, quietHoursEnd: 9, timezone: IST };
    // 23:00 IST → fixed window until 07:00, then the user's until 09:00 IST (03:30 UTC).
    expect(reminderQuietEnd(user, new Date('2026-10-19T17:30:00Z'))).toEqual(
      new Date('2026-10-20T03:30:00Z'),
    );
  });

  it('uses the user timezone, not IST, when it differs', () => {
    const london = { quietHoursStart: null, quietHoursEnd: null, timezone: 'Europe/London' };
    // 17:00 UTC is 18:00 in London (BST): fine there, though it is 22:30 in India.
    expect(reminderQuietEnd(london, new Date('2026-10-19T17:00:00Z'))).toBeNull();
  });
});

describe('isStaleOnArrival', () => {
  it('a late follow-up is still sent; a late deadline/interview reminder is not', () => {
    const longAgo = new Date(NOW.getTime() - 3 * DAY);
    expect(isStaleOnArrival('FOLLOW_UP', longAgo, NOW)).toBe(false);
    expect(isStaleOnArrival('DEADLINE_3D', longAgo, NOW)).toBe(true);
    expect(
      isStaleOnArrival('INTERVIEW_DAY_BEFORE', new Date(NOW.getTime() - 30 * 60_000), NOW),
    ).toBe(false);
  });
});

describe('reminderMessage', () => {
  it('names the job and what to do', () => {
    expect(
      reminderMessage('FOLLOW_UP', { title: 'SDE I', company: 'Hevo', daysSinceChange: 7 }),
    ).toBe('Follow up on SDE I at Hevo: no update for 7 days since you applied.');
    expect(reminderMessage('DEADLINE_1D', { title: 'SDE I', company: 'Hevo' })).toBe(
      '1 day left to apply: SDE I at Hevo.',
    );
  });
});
