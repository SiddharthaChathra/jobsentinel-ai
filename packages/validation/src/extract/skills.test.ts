import { extractGraduationYear, extractSkills } from './skills';

describe('extractSkills', () => {
  it('matches canonical names and aliases as whole words, once per skill', () => {
    const names = extractSkills(
      'Skills: Python, C++, C, Java, postgres, ReactJS, AWS (EC2, S3), Linux, k8s. Javanese speaker.',
    ).map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'Python',
        'C++',
        'C',
        'Java',
        'PostgreSQL',
        'React',
        'AWS',
        'Linux',
        'Kubernetes',
      ]),
    );
    expect(names.filter((n) => n === 'Java')).toHaveLength(1);
  });
  it('does not match single letters outside list context', () => {
    const names = extractSkills('I got a grade of C in history and love R&B music').map(
      (s) => s.name,
    );
    expect(names).not.toContain('C');
    expect(names).not.toContain('R');
  });
  it('reports what matched', () => {
    const [go] = extractSkills('Backend in golang');
    expect(go).toMatchObject({ name: 'Go', matchedOn: 'golang' });
  });
});

describe('extractGraduationYear', () => {
  const now = new Date('2026-09-22');
  it.each([
    ['B.E. CSE, expected 2027', 2027],
    ['Batch of 2026', 2026],
    ['B.Tech (2023 – 2027)', 2027],
    ['B.Tech 2023-27', 2027],
    ['Graduated in 2024', 2024],
    ['no years here', null],
    ['founded 1999, expected 2050', null],
  ])('%s → %s', (text, expected) => {
    expect(extractGraduationYear(text, now)).toBe(expected);
  });
});
