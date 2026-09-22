import { normalizeTitle } from './title';

describe('normalizeTitle', () => {
  it.each([
    ['Software Engineer (Fresher) - Bengaluru', 'software engineer bengaluru'],
    ['SDE-1', 'software development engineer 1'],
    ['  Sr.   Network   Engineer ', 'senior network engineer'],
    ['C++ Developer / Embedded', 'c++ developer embedded'],
    ['Graduate Engineer Trainee [2026 Batch]', 'graduate engineer trainee'],
    ['.NET Developer', '.net developer'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeTitle(input)).toBe(expected);
  });
});
