import { checkQuota, type QuotaLimits } from './quota';

const ADZUNA: QuotaLimits = { perMinute: 25, perDay: 250, perWeek: 1000, perMonth: 2500 };
const used = (perMinute: number, perDay: number, perWeek: number, perMonth: number) => ({
  perMinute,
  perDay,
  perWeek,
  perMonth,
});

describe('checkQuota (F3, D108)', () => {
  it('allows a scan well inside every window', () => {
    expect(checkQuota(used(0, 50, 300, 900), ADZUNA, 2)).toEqual({ allowed: true });
  });

  it('stops BEFORE the limit: 90% of 250/day is 225, so 224 + 2 is refused', () => {
    expect(checkQuota(used(0, 223, 300, 900), ADZUNA, 2)).toEqual({ allowed: true });
    expect(checkQuota(used(0, 224, 300, 900), ADZUNA, 2)).toMatchObject({
      allowed: false,
      window: 'perDay',
      cap: 225,
    });
  });

  it('checks every window, the monthly one included — the binding one for Adzuna', () => {
    expect(checkQuota(used(0, 10, 100, 2249), ADZUNA, 2)).toMatchObject({
      allowed: false,
      window: 'perMonth',
      cap: 2250,
    });
    expect(checkQuota(used(0, 10, 899, 1000), ADZUNA, 2)).toMatchObject({ window: 'perWeek' });
    expect(checkQuota(used(22, 30, 100, 1000), ADZUNA, 2)).toMatchObject({ window: 'perMinute' });
  });

  it('never allows a scan that would land exactly over the limit, whatever the safety', () => {
    expect(checkQuota(used(0, 249, 300, 900), ADZUNA, 2, 1)).toMatchObject({ allowed: false });
    expect(checkQuota(used(0, 248, 300, 900), ADZUNA, 2, 1)).toEqual({ allowed: true });
  });
});
