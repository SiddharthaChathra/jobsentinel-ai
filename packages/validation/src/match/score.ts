import { PRIORITY_BANDS, SKILL_DICTIONARY } from '@jobsentinel/config';
import type {
  EmploymentType,
  ExperienceLevel,
  JobCategory,
  PriorityBand,
  RoleTier,
} from '@jobsentinel/types';

export interface MatchProfile {
  skills: string[];
  /** Preferred roles with their tier, already normalized to role families where possible. */
  roles: { roleFamily: string; normalizedTitle: string; tier: RoleTier; enabled: boolean }[];
  locations: string[];
  remotePreference: 'ANY' | 'REMOTE_ONLY' | 'ONSITE_ONLY' | 'HYBRID_OK';
  employmentTypes: EmploymentType[];
  categories: JobCategory[];
  fresherOnly: boolean;
  graduationYear: number | null;
}

export interface MatchJob {
  title: string;
  roleFamily: string;
  category: JobCategory;
  skills: string[];
  /** Skills the posting actually requires, when the AI extracted them (docs 09 §3). */
  mustHaveSkills?: string[];
  niceToHaveSkills?: string[];
  experienceLevel: ExperienceLevel;
  fresherEligible: boolean | null;
  employmentType: EmploymentType;
  locationCity: string | null;
  locationCountry: string | null;
  isRemote: boolean;
}

export interface MatchScore {
  overall: number;
  skillScore: number;
  roleScore: number;
  experienceScore: number;
  locationScore: number;
  priority: PriorityBand;
  matchedSkills: string[];
  missingSkills: string[];
  explanation: string;
}

/** Weights from docs 09 §5. Skills dominate, then role, then experience, then location. */
const WEIGHTS = { skill: 0.4, role: 0.3, experience: 0.2, location: 0.1 } as const;
const NICE_TO_HAVE_WEIGHT = 0.4;
/**
 * Ceiling for a job whose experience requirement the profile cannot meet (D52). Below the
 * MEDIUM band, so a senior role can still be ranked among the rest but never presented as a
 * decent fit — however well its title, skills and location line up.
 */
const EXPERIENCE_MISMATCH_CAP = 45;

function combine(parts: {
  skillScore: number;
  roleScore: number;
  experienceScore: number;
  locationScore: number;
}): number {
  const weighted = Math.round(
    parts.skillScore * WEIGHTS.skill +
      parts.roleScore * WEIGHTS.role +
      parts.experienceScore * WEIGHTS.experience +
      parts.locationScore * WEIGHTS.location,
  );
  return parts.experienceScore === 0 ? Math.min(weighted, EXPERIENCE_MISMATCH_CAP) : weighted;
}

let aliasMap: Map<string, string> | null = null;

/** Resolves a skill string to its canonical dictionary name ("postgres" → "PostgreSQL"). */
export function canonicalSkill(name: string): string {
  if (!aliasMap) {
    aliasMap = new Map();
    for (const def of SKILL_DICTIONARY) {
      aliasMap.set(def.name.toLowerCase(), def.name);
      for (const alias of def.aliases ?? []) aliasMap.set(alias.toLowerCase(), def.name);
    }
  }
  const key = name.trim().toLowerCase();
  return aliasMap.get(key) ?? name.trim();
}

function canonicalSet(names: string[]): Set<string> {
  return new Set(names.map((n) => canonicalSkill(n)));
}

/**
 * Deterministic resume ↔ job score (docs 09 §5). Always computed, with or without AI, so a job
 * is never unscored and the AI has a baseline it may only refine within bounds.
 */
export function scoreMatch(profile: MatchProfile, job: MatchJob): MatchScore {
  const profileSkills = canonicalSet(profile.skills);

  // ── skills ────────────────────────────────────────────────────────────────
  const mustHave = canonicalSet(job.mustHaveSkills ?? []);
  const niceToHave = canonicalSet(job.niceToHaveSkills ?? []);
  // Without AI-extracted requirements, the skills found in the description are the requirement.
  const fallback = mustHave.size === 0 && niceToHave.size === 0;
  const required = fallback ? canonicalSet(job.skills) : mustHave;
  const optional = fallback ? new Set<string>() : niceToHave;

  const matched: string[] = [];
  const missing: string[] = [];
  let earned = 0;
  let possible = 0;
  for (const skill of required) {
    possible += 1;
    if (profileSkills.has(skill)) {
      earned += 1;
      matched.push(skill);
    } else missing.push(skill);
  }
  for (const skill of optional) {
    possible += NICE_TO_HAVE_WEIGHT;
    if (profileSkills.has(skill)) {
      earned += NICE_TO_HAVE_WEIGHT;
      matched.push(skill);
    }
  }
  // A posting that lists no skills at all cannot be scored on skills; treat it as neutral
  // rather than zero, so a thin but relevant posting is not buried.
  const skillScore = possible === 0 ? 50 : Math.round((earned / possible) * 100);

  // ── role ──────────────────────────────────────────────────────────────────
  const enabledRoles = profile.roles.filter((r) => r.enabled);
  const tierOf = (family: string): RoleTier | null =>
    enabledRoles.find((r) => r.roleFamily === family)?.tier ?? null;
  const exactTier = tierOf(job.roleFamily);
  let roleScore: number;
  if (exactTier === 'PRIMARY') roleScore = 100;
  else if (exactTier === 'SECONDARY') roleScore = 80;
  else if (exactTier === 'OTHER') roleScore = 60;
  else if (profile.categories.includes(job.category)) roleScore = 30;
  else roleScore = 10;

  // ── experience ────────────────────────────────────────────────────────────
  const experienceScore =
    job.experienceLevel === 'FRESHER'
      ? 100
      : job.experienceLevel === 'ENTRY_LEVEL'
        ? 85
        : job.experienceLevel === 'UNKNOWN'
          ? 50
          : profile.fresherOnly
            ? 0
            : 10;

  // ── location ──────────────────────────────────────────────────────────────
  const wanted = profile.locations.map((l) => l.toLowerCase().trim()).filter(Boolean);
  const wantsRemote = profile.remotePreference === 'REMOTE_ONLY' || wanted.includes('remote');
  let locationScore: number;
  if (profile.remotePreference === 'ONSITE_ONLY' && job.isRemote) locationScore = 40;
  else if (job.isRemote && (wantsRemote || profile.remotePreference === 'ANY')) locationScore = 100;
  else if (wanted.length === 0) locationScore = 100;
  else if (
    job.locationCity &&
    wanted.some(
      (w) =>
        job.locationCity!.toLowerCase().includes(w) || w.includes(job.locationCity!.toLowerCase()),
    )
  )
    locationScore = 100;
  else if (
    job.locationCountry &&
    wanted.some(
      (w) =>
        job.locationCountry!.toLowerCase().includes(w) ||
        w.includes(job.locationCountry!.toLowerCase()),
    )
  )
    locationScore = 75;
  else if (!job.locationCity && !job.locationCountry) locationScore = 60;
  else locationScore = 25;

  const overall = combine({ skillScore, roleScore, experienceScore, locationScore });

  return {
    overall,
    skillScore,
    roleScore,
    experienceScore,
    locationScore,
    priority: priorityFor(overall),
    matchedSkills: matched.sort(),
    missingSkills: missing.sort().slice(0, 12),
    explanation: buildExplanation({
      overall,
      matched,
      missing,
      job,
      roleScore,
      experienceScore,
      locationScore,
    }),
  };
}

export function priorityFor(overall: number): PriorityBand {
  for (const band of PRIORITY_BANDS) {
    if (overall >= band.min) return band.band;
  }
  return 'OTHER';
}

function buildExplanation(input: {
  overall: number;
  matched: string[];
  missing: string[];
  job: MatchJob;
  roleScore: number;
  experienceScore: number;
  locationScore: number;
}): string {
  const parts: string[] = [];
  if (input.matched.length > 0)
    parts.push(
      input.matched
        .slice(0, 6)
        .map((s) => `✓ ${s}`)
        .join(' '),
    );
  if (input.missing.length > 0)
    parts.push(
      input.missing
        .slice(0, 3)
        .map((s) => `✗ ${s}`)
        .join(' '),
    );
  if (input.job.fresherEligible === true) parts.push('✓ Fresher eligible');
  else if (input.job.experienceLevel === 'EXPERIENCED') parts.push('✗ Asks for experience');
  else if (input.job.experienceLevel === 'UNKNOWN') parts.push('? Experience unclear');
  if (input.roleScore >= 80) parts.push('✓ Preferred role');
  else if (input.roleScore <= 30) parts.push('✗ Different role');
  if (input.job.isRemote) parts.push('✓ Remote');
  else if (input.locationScore >= 75 && input.job.locationCity)
    parts.push(`✓ ${input.job.locationCity}`);
  else if (input.locationScore <= 40 && input.job.locationCity)
    parts.push(`✗ ${input.job.locationCity}`);
  return `Match ${input.overall}% — ${parts.join(' · ')}`;
}

/**
 * Applies an AI refinement to the deterministic skill/role scores, bounded to ±25 points
 * (docs 09 §5) so a hallucinated judgement can never rewrite the ranking.
 */
export function applyAiRefinement(
  base: MatchScore,
  ai: {
    skillScore: number;
    roleScore: number;
    matchedSkills: string[];
    missingSkills: string[];
    explanation: string;
  },
  maxDelta = 25,
): MatchScore {
  const bound = (aiValue: number, baseValue: number) => {
    const clampedAi = Math.max(0, Math.min(100, Math.round(aiValue)));
    return Math.max(baseValue - maxDelta, Math.min(baseValue + maxDelta, clampedAi));
  };
  const skillScore = bound(ai.skillScore, base.skillScore);
  const roleScore = bound(ai.roleScore, base.roleScore);
  const overall = combine({
    skillScore,
    roleScore,
    experienceScore: base.experienceScore,
    locationScore: base.locationScore,
  });
  return {
    ...base,
    skillScore,
    roleScore,
    overall,
    priority: priorityFor(overall),
    matchedSkills:
      ai.matchedSkills.length > 0
        ? ai.matchedSkills.map(canonicalSkill).sort()
        : base.matchedSkills,
    missingSkills:
      ai.missingSkills.length > 0
        ? ai.missingSkills.map(canonicalSkill).sort().slice(0, 12)
        : base.missingSkills,
    explanation: ai.explanation.trim() || base.explanation,
  };
}
