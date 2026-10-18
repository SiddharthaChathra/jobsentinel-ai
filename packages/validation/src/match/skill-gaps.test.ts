import { LEARNING_LINKS, approvedLearningLinks } from '@jobsentinel/config';
import { rankSkillGaps, type GapInputJob } from './skill-gaps';

const job = (id: string, missingSkills: string[]): GapInputJob => ({
  id,
  title: `Job ${id}`,
  company: `Co ${id}`,
  missingSkills,
});

describe('rankSkillGaps (F7, D120)', () => {
  it('counts on a hand-built fixture: SQL missing in 3 of 4', () => {
    const gaps = rankSkillGaps([
      job('1', ['SQL', 'Docker']),
      job('2', ['SQL']),
      job('3', ['SQL', 'Kubernetes']),
      job('4', ['Docker']),
    ]);
    expect(gaps.map((g) => [g.skill, g.missingIn, g.of])).toEqual([
      ['SQL', 3, 4],
      ['Docker', 2, 4],
      ['Kubernetes', 1, 4],
    ]);
    expect(gaps[0]!.jobs.map((j) => j.id)).toEqual(['1', '2', '3']);
  });

  it('merges aliases: Postgres = PostgreSQL, k8s = Kubernetes, and counts a job once', () => {
    const gaps = rankSkillGaps([
      job('1', ['postgres', 'PostgreSQL', 'k8s']),
      job('2', ['PostgreSQL', 'Kubernetes']),
      job('3', ['psql']),
    ]);
    expect(gaps.map((g) => [g.skill, g.missingIn])).toEqual([
      ['PostgreSQL', 3],
      ['Kubernetes', 2],
    ]);
  });

  it('leaves soft skills out: nearly every posting asks for them and no link teaches them', () => {
    const gaps = rankSkillGaps([
      job('1', ['Communication', 'Teamwork', 'Go']),
      job('2', ['Leadership']),
    ]);
    expect(gaps.map((g) => g.skill)).toEqual(['Go']);
  });

  it('ranks soft skills separately on request (the short soft-skills note)', () => {
    const jobs = [
      job('1', ['Communication', 'Teamwork', 'Go']),
      job('2', ['communication', 'Leadership']),
    ];
    expect(rankSkillGaps(jobs, 3, { soft: 'only' }).map((g) => [g.skill, g.missingIn])).toEqual([
      ['Communication', 2],
      ['Leadership', 1],
      ['Teamwork', 1],
    ]);
    expect(rankSkillGaps(jobs, 3).map((g) => g.skill)).toEqual(['Go']);
  });

  it('is deterministic on ties (alphabetical) and honours the limit', () => {
    const gaps = rankSkillGaps([job('1', ['Rust', 'Go', 'C++'])], 2);
    expect(gaps.map((g) => g.skill)).toEqual(['C++', 'Go']);
  });

  it('keeps an unknown skill under its own name', () => {
    expect(rankSkillGaps([job('1', ['Quantum Widgets'])])[0]!.skill).toBe('Quantum Widgets');
  });

  it('nothing to rank: an empty report', () => {
    expect(rankSkillGaps([])).toEqual([]);
  });
});

describe('curated learning links (F7, D120)', () => {
  it('only approved entries are served; nothing is linked until the owner approves it', () => {
    for (const [skill, entry] of Object.entries(LEARNING_LINKS.skills)) {
      expect(approvedLearningLinks(skill)).toEqual(entry.approved ? entry.links : []);
    }
    expect(approvedLearningLinks('Not In The Map')).toEqual([]);
  });

  it('every link is https and every entry has 1-3 links (schema-checked at load)', () => {
    for (const entry of Object.values(LEARNING_LINKS.skills)) {
      expect(entry.links.length).toBeGreaterThanOrEqual(1);
      expect(entry.links.length).toBeLessThanOrEqual(3);
      for (const l of entry.links) expect(l.url.startsWith('https://')).toBe(true);
    }
  });
});
