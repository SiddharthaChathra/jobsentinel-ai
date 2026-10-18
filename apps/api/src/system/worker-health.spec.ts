import { windowOpenedAt, workerHealth } from './worker-health';

const IST = 'Asia/Kolkata';
const at = (iso: string) => new Date(iso);
const base = { intervalMin: 30, hours: '7-24', tz: IST };

describe('workerHealth (F11, D124)', () => {
  it('ok when the last beat is within 2× the interval (60 min)', () => {
    const r = workerHealth({
      ...base,
      now: at('2026-10-18T06:00:00Z'),
      lastBeatAt: at('2026-10-18T05:05:00Z'),
    });
    expect(r).toMatchObject({ status: 'ok', ageMin: 55, thresholdMin: 60 });
  });

  it('unhealthy once the beat is older than 2× the interval', () => {
    const r = workerHealth({
      ...base,
      now: at('2026-10-18T06:00:00Z'),
      lastBeatAt: at('2026-10-18T04:59:00Z'),
    });
    expect(r).toMatchObject({ status: 'unhealthy', ageMin: 61 });
  });

  it('outside the active hours (00:30 IST) it never alarms: the API and dispatch sleep (D99)', () => {
    const r = workerHealth({
      ...base,
      now: at('2026-10-17T19:00:00Z'),
      lastBeatAt: at('2026-10-17T12:00:00Z'),
    });
    expect(r).toMatchObject({ status: 'outside_active_hours', ageMin: null });
  });

  it('the morning window opening (07:00 IST) does not count the overnight gap', () => {
    // 07:40 IST, last beat 23:50 IST the night before: measured from 07:00, 40 min — ok.
    const ok = workerHealth({
      ...base,
      now: at('2026-10-18T02:10:00Z'),
      lastBeatAt: at('2026-10-17T18:20:00Z'),
    });
    expect(ok).toMatchObject({ status: 'ok', ageMin: 40 });
    // 08:05 IST with still no beat since last night: 65 min since the window opened — unhealthy.
    const down = workerHealth({
      ...base,
      now: at('2026-10-18T02:35:00Z'),
      lastBeatAt: at('2026-10-17T18:20:00Z'),
    });
    expect(down.status).toBe('unhealthy');
  });

  it('never beaten: unhealthy inside an all-day window, measured from the window otherwise', () => {
    expect(
      workerHealth({ ...base, hours: '0-24', now: at('2026-10-18T06:00:00Z'), lastBeatAt: null })
        .status,
    ).toBe('unhealthy');
    expect(
      workerHealth({ ...base, now: at('2026-10-18T02:00:00Z'), lastBeatAt: null }), // 07:30 IST
    ).toMatchObject({ status: 'ok', ageMin: 30 });
  });

  it('window opening: today for 7-24, yesterday after midnight for a wrapping 22-6, none for 0-24', () => {
    expect(windowOpenedAt(at('2026-10-18T06:00:00Z'), '7-24', IST)).toEqual(
      at('2026-10-18T01:30:00Z'),
    );
    // 02:00 IST on the 18th, window 22-6: it opened at 22:00 IST on the 17th (16:30 UTC).
    expect(windowOpenedAt(at('2026-10-17T20:30:00Z'), '22-6', IST)).toEqual(
      at('2026-10-17T16:30:00Z'),
    );
    expect(windowOpenedAt(at('2026-10-18T06:00:00Z'), '0-24', IST)).toBeNull();
  });
});
