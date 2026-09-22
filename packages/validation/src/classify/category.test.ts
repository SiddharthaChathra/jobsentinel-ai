import { classifyCategory } from './category';

describe('classifyCategory', () => {
  it.each([
    ['Software Engineer', 'SOFTWARE'],
    ['Technical Support Engineer', 'IT_SUPPORT'],
    ['Network Engineer - L1', 'NETWORK'],
    ['Associate Cloud Engineer', 'CLOUD_DEVOPS'],
    ['Data Analyst Intern', 'DATA'],
    ['Mechanical Design Engineer', 'MECHANICAL'],
  ])('%s → %s', (title, category) => {
    expect(classifyCategory({ title }).category).toBe(category);
  });

  it.each([
    'Enterprise Account Executive',
    'Sales Development Representative',
    'Senior Product Manager, Logs - Observability',
    'Customer Success Manager',
    'Talent Acquisition Partner',
    'Video Editor Intern',
    'Nurse Practitioner (Grand Rapids, MI)',
    'Senior Project Manager, Professional Services',
  ])('%s → NON_ENGINEERING', (title) => {
    const r = classifyCategory({ title });
    expect(r.category).toBe('NON_ENGINEERING');
    expect(r.isEngineering).toBe(false);
  });

  it('keeps technical hybrids on the engineering side', () => {
    for (const title of [
      'Sales Engineer',
      'Solutions Engineer',
      'Technical Account Manager Analyst (New Grad)',
      'Forward Deployed Engineer',
    ]) {
      expect(classifyCategory({ title }).isEngineering).toBe(true);
    }
  });

  it('falls back to departments, then gives up honestly', () => {
    expect(
      classifyCategory({
        title: 'Member of Technical Staff',
        departments: ['Platform Engineering'],
      }).isEngineering,
    ).toBe(true);
    expect(classifyCategory({ title: 'Analyst', departments: ['Finance'] }).category).toBe(
      'NON_ENGINEERING',
    );
    expect(classifyCategory({ title: 'Generalist' }).category).toBe('UNKNOWN');
  });
});
