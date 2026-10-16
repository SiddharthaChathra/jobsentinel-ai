import { isFresherRole, MAX_FRESHER_MIN_YEARS } from './fresher-policy';

describe('isFresherRole (D96)', () => {
  it.each([
    ['FRESHER', null],
    ['FRESHER', 0],
    ['ENTRY_LEVEL', null],
    ['ENTRY_LEVEL', 0],
    ['ENTRY_LEVEL', 1],
  ] as const)('lists %s asking for %s years', (level, minYears) => {
    expect(isFresherRole({ level, minYears })).toBe(true);
  });

  it.each([
    ['EXPERIENCED', null],
    ['EXPERIENCED', 0],
    ['UNKNOWN', null],
    ['UNKNOWN', 0],
    ['ENTRY_LEVEL', 2],
    ['FRESHER', 3], // contradictory posting: the stated years win
    ['ENTRY_LEVEL', 1.5],
  ] as const)('does not list %s asking for %s years', (level, minYears) => {
    expect(isFresherRole({ level, minYears })).toBe(false);
  });

  it('draws the line at one year', () => {
    expect(MAX_FRESHER_MIN_YEARS).toBe(1);
  });
});
