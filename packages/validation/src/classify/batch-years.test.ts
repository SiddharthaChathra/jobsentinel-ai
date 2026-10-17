import { extractBatchYears, isBatchEligible } from './batch-years';

describe('extractBatchYears (F3, D107)', () => {
  it.each([
    ['2025/2026/2027 batch', [2025, 2026, 2027]],
    ['Open to 2026/27 batch students', [2026, 2027]],
    ['2025, 2026 & 2027 passouts can apply', [2025, 2026, 2027]],
    ['2024-2027 graduates', [2024, 2025, 2026, 2027]],
    ['B.E./B.Tech 2027 freshers', [2027]],
    ['Batch of 2026 and 2027', [2026, 2027]],
    ['Batches: 2026, 2027', [2026, 2027]],
    ['Class of 2027', [2027]],
    ['Graduating in 2026 or 2027', [2026, 2027]],
    ['Generative AI Engineer - Freshers 2026/27 (Computer Science)', [2026, 2027]],
    ['2025 passouts only', [2025]],
    ['2026 batch only', [2026]],
    ["'27 batch preferred", null], // a bare two-digit year with no century is not trusted
  ])('%s → %j', (text, years) => {
    expect(extractBatchYears(text)).toEqual(years);
  });

  it('ignores years that are not about a batch', () => {
    expect(extractBatchYears('Founded in 2015, we raised Series B in 2025.')).toBeNull();
    expect(extractBatchYears('Freshers welcome. 0 years of experience.')).toBeNull();
    expect(extractBatchYears('Salary revised in 2026 for all roles.')).toBeNull();
  });
});

describe('isBatchEligible for a 2027 graduate (R2)', () => {
  const eligible = (text: string) => isBatchEligible(extractBatchYears(text), 2027);

  it.each([
    ['2025 passouts only', false],
    ['2026 batch only', false],
    ['2025/2026/2027 batch', true],
    ['2026/27 batch', true],
    ['Freshers welcome, no batch named', true],
    ['2028 batch', false],
  ])('%s → %s', (text, ok) => {
    expect(eligible(text)).toBe(ok);
  });

  it('applies no gate when the graduation year is unknown', () => {
    expect(isBatchEligible([2025], null)).toBe(true);
  });
});
