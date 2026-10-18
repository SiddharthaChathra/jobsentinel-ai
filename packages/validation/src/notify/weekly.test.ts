import { localWeekday, weeklySummaryWindow } from './weekly';

const IST = 'Asia/Kolkata';

describe('weeklySummaryWindow (F6, D121)', () => {
  // Sunday 18 Oct 2026. 09:00 IST = 03:30 UTC.
  it('is due from Sunday 09:00 IST, keyed by that Sunday, covering the 7 days before', () => {
    const w = weeklySummaryWindow(new Date('2026-10-18T03:30:00Z'), IST);
    expect(w).toEqual({
      due: true,
      weekKey: '2026-10-18',
      from: new Date('2026-10-11T03:30:00Z'),
      to: new Date('2026-10-18T03:30:00Z'),
    });
  });

  it('Sunday 08:59 IST is not due yet; it still belongs to last week, long past its window', () => {
    const w = weeklySummaryWindow(new Date('2026-10-18T03:29:00Z'), IST);
    expect(w.due).toBe(false);
    expect(w.weekKey).toBe('2026-10-11');
  });

  it('stays due for 24 hours, then waits for next Sunday', () => {
    expect(weeklySummaryWindow(new Date('2026-10-19T03:29:00Z'), IST)).toMatchObject({
      due: true,
      weekKey: '2026-10-18',
    });
    expect(weeklySummaryWindow(new Date('2026-10-19T03:31:00Z'), IST).due).toBe(false);
    expect(weeklySummaryWindow(new Date('2026-10-21T10:00:00Z'), IST)).toMatchObject({
      due: false,
      weekKey: '2026-10-18',
    });
  });

  it('uses the local Sunday across the IST/UTC date boundary', () => {
    // Saturday 17 Oct 20:00 UTC is already Sunday 01:30 IST — not yet 09:00, so not due.
    expect(localWeekday(new Date('2026-10-17T20:00:00Z'), IST)).toBe(0);
    expect(weeklySummaryWindow(new Date('2026-10-17T20:00:00Z'), IST).due).toBe(false);
  });

  it('follows the user timezone, not IST', () => {
    // 09:00 in London (BST, UTC+1) on Sunday 18 Oct is 08:00 UTC.
    expect(weeklySummaryWindow(new Date('2026-10-18T07:59:00Z'), 'Europe/London').due).toBe(false);
    expect(weeklySummaryWindow(new Date('2026-10-18T08:00:00Z'), 'Europe/London')).toMatchObject({
      due: true,
      weekKey: '2026-10-18',
    });
  });
});
