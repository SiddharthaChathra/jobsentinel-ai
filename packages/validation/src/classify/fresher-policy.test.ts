import { classifyExperience } from './experience';
import { isFresherRole, MAX_FRESHER_MIN_YEARS } from './fresher-policy';

describe('isFresherRole (D96)', () => {
  it.each([
    ['FRESHER', null],
    ['ENTRY_LEVEL', null],
    ['FRESHER', 0],
    ['ENTRY_LEVEL', 0],
    // A stated zero is enough on its own, even when the rules could not place the role.
    ['UNKNOWN', 0],
  ] as const)('lists %s with a minimum of %s years', (level, minYears) => {
    expect(isFresherRole({ level, minYears })).toBe(true);
  });

  it.each([
    ['UNKNOWN', null], // nothing stated, nothing placed: waits for the AI instead
    ['EXPERIENCED', null],
    ['EXPERIENCED', 0], // "Senior Software Engineer, 0-5 years": the senior title wins
    ['FRESHER', 1], // "1-3 years" asks for experience a fresher does not have
    ['ENTRY_LEVEL', 1],
    ['ENTRY_LEVEL', 2],
    ['ENTRY_LEVEL', 0.5],
  ] as const)('does not list %s with a minimum of %s years', (level, minYears) => {
    expect(isFresherRole({ level, minYears })).toBe(false);
  });

  it('only zero counts as a fresher minimum', () => {
    expect(MAX_FRESHER_MIN_YEARS).toBe(0);
  });

  // End to end through the real rules: the upper end of a range starting at zero never matters.
  it.each([
    ['Software Engineer', '0-3 years of experience', '', true],
    ['Software Engineer', '0-5 years', '', true],
    ['Data Analyst', 'Experience: 0 to 6 yrs', '', true],
    ['Backend Developer', null, 'Candidates with 0-4 years of experience can apply.', true],
    ['Associate Engineer', '1-3 years', '', false],
    ['Engineer', '2-5 years', '', false],
    ['Senior Software Engineer', '0-5 years', '', false],
    ['Graduate Engineer Trainee', null, '', true],
  ])('%s, "%s%s" -> listed: %s', (title, experienceText, description, listed) => {
    const r = classifyExperience({
      title,
      experienceText,
      description,
      employmentType: 'FULL_TIME',
    });
    expect(isFresherRole({ level: r.level, minYears: r.minYears })).toBe(listed);
  });
});
