import { classifyExperience } from './experience';

const c = (title: string, description = '', experienceText?: string) =>
  classifyExperience({ title, description, experienceText });

describe('classifyExperience — clear fresher cases', () => {
  it.each([
    ['Software Engineer (Fresher)', ''],
    ['Graduate Engineer Trainee', ''],
    ['Software Engineering Intern', ''],
    ['SDE-1', 'Looking for 0-1 years of experience.'],
    ['Associate Software Engineer', 'Freshers are welcome to apply. 2027 batch.'],
    ['Network Engineer', 'Experience: 0-1 years. Recent graduates encouraged.'],
    ['Technical Support Engineer', 'No prior experience required; we train you.'],
  ])('%s → FRESHER', (title, body) => {
    const r = c(title, body);
    expect(r.level).toBe('FRESHER');
    expect(r.fresherEligible).toBe(true);
    expect(r.confidence).toBeGreaterThanOrEqual(0.75);
    expect(r.evidence.length).toBeGreaterThan(0);
  });
});

describe('classifyExperience — clear experienced cases', () => {
  it.each([
    ['Senior Software Engineer', ''],
    ['Staff Engineer', ''],
    ['Engineering Manager', ''],
    ['Principal Java Engineer - Distributed Systems', ''],
    ['Software Engineer III', ''],
    ['Solutions Architect', 'You have 8+ years of experience building distributed systems.'],
    ['Software Engineer', 'Minimum 5 years of professional experience required.'],
    ['Data Engineer', '5+ years experience with Spark and Kafka.'],
  ])('%s → EXPERIENCED', (title, body) => {
    const r = c(title, body);
    expect(r.level).toBe('EXPERIENCED');
    expect(r.fresherEligible).toBe(false);
  });

  it('parsed years outrank a fresher-sounding title', () => {
    const r = c('Junior Data Scientist', 'Requires 5+ years of experience in ML.');
    expect(r.level).toBe('EXPERIENCED');
    expect(r.evidence.some((e) => e.code === 'YEARS_PARSED')).toBe(true);
  });
});

describe('classifyExperience — entry level and ambiguity', () => {
  it('1-3 years is ENTRY_LEVEL, not fresher', () => {
    const r = c('Software Engineer', 'You have 1-3 years of experience.');
    expect(r.level).toBe('ENTRY_LEVEL');
    expect(r.fresherEligible).toBe(true);
  });

  it('a bare title with no signals is UNKNOWN and flagged for AI', () => {
    const r = c('Software Engineer', 'Join our team to build great products.');
    expect(r.level).toBe('UNKNOWN');
    expect(r.fresherEligible).toBeNull();
    expect(r.needsAi).toBe(true);
  });

  it('contradictory signals (senior title + 0-2 years) are UNKNOWN, never silently EXPERIENCED', () => {
    const r = c('Senior Software Engineer', 'Experience: 0-2 years.');
    expect(r.level).toBe('UNKNOWN');
    expect(r.needsAi).toBe(true);
  });

  it('internships are fresher-eligible even with a senior-sounding department', () => {
    const r = classifyExperience({
      title: 'Research Science Intern (PhD)',
      description: '',
      employmentType: 'INTERNSHIP',
    });
    expect(r.level).toBe('FRESHER');
  });

  it('roman numeral II is treated as experienced, plain I is not', () => {
    expect(c('Software Engineer II').level).toBe('EXPERIENCED');
    expect(c('Software Engineer I', 'Entry level role.').level).toBe('FRESHER');
  });

  it('always reports the parsed range and evidence for explainability', () => {
    const r = c('Backend Engineer', 'We need 3+ years of experience.');
    expect(r.minYears).toBe(3);
    expect(r.evidence.map((e) => e.code)).toContain('YEARS_PARSED');
  });
});
