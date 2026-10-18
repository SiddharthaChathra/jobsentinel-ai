import { SKILL_DICTIONARY } from '@jobsentinel/config';
import { canonicalSkill } from './score';

/** One of the user's top matches, with the skills the job asks for that the profile lacks. */
export interface GapInputJob {
  id: string;
  title: string;
  company: string;
  missingSkills: string[];
}

export interface SkillGap {
  /** Canonical name ("PostgreSQL", never "postgres"). */
  skill: string;
  /** How many of the jobs miss it. */
  missingIn: number;
  /** How many jobs the report is based on. */
  of: number;
  /** Up to 3 of those jobs, best match first. */
  jobs: { id: string; title: string; company: string }[];
}

let soft: Set<string> | null = null;
/** Soft skills ("Communication", "Teamwork") are in nearly every posting and no link teaches them. */
function isSoft(skill: string): boolean {
  soft ??= new Set(SKILL_DICTIONARY.filter((s) => s.category === 'SOFT').map((s) => s.name));
  return soft.has(skill);
}

/**
 * Ranks the skills missing across the user's top matches (F7, D120): "SQL missing in 9 of 15".
 * Rules only, no AI. Aliases are merged first (Postgres = PostgreSQL, k8s = Kubernetes) and each
 * job counts a skill once. Ordered by how many jobs miss it, then alphabetically, so the same
 * input always gives the same report. `jobs` must already be the eligible, ranked top matches.
 */
export function rankSkillGaps(
  jobs: GapInputJob[],
  limit = 10,
  opts: { soft?: 'exclude' | 'only' } = {},
): SkillGap[] {
  const wantSoft = opts.soft === 'only';
  const bySkill = new Map<string, SkillGap>();
  for (const job of jobs) {
    const skills = new Set(
      job.missingSkills.map((s) => canonicalSkill(s)).filter((s) => s && isSoft(s) === wantSoft),
    );
    for (const skill of skills) {
      const gap = bySkill.get(skill) ?? { skill, missingIn: 0, of: jobs.length, jobs: [] };
      gap.missingIn += 1;
      if (gap.jobs.length < 3)
        gap.jobs.push({ id: job.id, title: job.title, company: job.company });
      bySkill.set(skill, gap);
    }
  }
  return [...bySkill.values()]
    .sort((a, b) => b.missingIn - a.missingIn || a.skill.localeCompare(b.skill))
    .slice(0, limit);
}
