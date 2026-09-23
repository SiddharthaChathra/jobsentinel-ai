import { extractJobBatchYear, isBatchYearCompatible } from './batch-year';

describe('extractJobBatchYear', () => {
  it.each([
    ['We are hiring 2025 batch only', 2025],
    ['Welcome to the batch of 2025', 2025],
    ['Looking for 2025 passouts', 2025],
    ['Graduating 2027', 2027],
    ['Class of 2027', 2027],
    ['We only want 2025 graduates', 2025],
    ['2024 or 2025 batch', 2025], // Takes the max
    ['Freshers welcome', null],
    ['Experience: 0-2 years', null],
  ])('%s → %s', (input, expected) => {
    expect(extractJobBatchYear(input)).toBe(expected);
  });
});

describe('isBatchYearCompatible', () => {
  it('is compatible when job specifies no batch', () => {
    expect(isBatchYearCompatible(null, 2027)).toBe(true);
  });

  it('is compatible when profile has no graduation year', () => {
    expect(isBatchYearCompatible(2025, null)).toBe(true);
  });

  it('is compatible when both are null', () => {
    expect(isBatchYearCompatible(null, null)).toBe(true);
  });

  it('is compatible when years match exactly', () => {
    expect(isBatchYearCompatible(2027, 2027)).toBe(true);
  });

  it('is incompatible when years mismatch', () => {
    expect(isBatchYearCompatible(2025, 2027)).toBe(false);
  });
});
