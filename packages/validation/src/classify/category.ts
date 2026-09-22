import { ENGINEERING_OVERRIDE_PATTERNS, NON_ENGINEERING_PATTERNS } from '@jobsentinel/config';
import type { JobCategory } from '@jobsentinel/types';
import { classifyRoleFamily } from './role-family';

/** Last-resort signal that a title is technical at all (seniority is decided separately). */
const GENERIC_ENGINEERING =
  /\b(engineer|engineering|developer|architect|programmer|scientist|sre|devops|technologist|technician)\b/i;

export interface CategoryClassification {
  category: JobCategory;
  roleFamily: string;
  isEngineering: boolean;
  reason: string;
}

export interface CategoryInput {
  title: string;
  departments?: string[] | null;
  skills?: string[] | null;
}

/**
 * Title-first category classification with a non-engineering gate (docs 09 §5, spec §9
 * "All engineering jobs"). Large ATS boards are mostly sales/marketing/PM roles; those become
 * NON_ENGINEERING so preferences can hide them without losing them.
 */
export function classifyCategory(input: CategoryInput): CategoryClassification {
  const title = input.title.trim();
  const engineeringOverride = ENGINEERING_OVERRIDE_PATTERNS.find((p) => p.test(title));
  const nonEngineering = NON_ENGINEERING_PATTERNS.find((p) => p.test(title));

  if (nonEngineering && !engineeringOverride) {
    return {
      category: 'NON_ENGINEERING',
      roleFamily: 'non_engineering',
      isEngineering: false,
      reason: `title matches ${nonEngineering.source.slice(0, 40)}`,
    };
  }

  const role = classifyRoleFamily(title);
  if (role.category === 'UNKNOWN' && engineeringOverride) {
    return {
      category: 'OTHER_ENGINEERING',
      roleFamily: 'unknown',
      isEngineering: true,
      reason: 'technical role title',
    };
  }
  if (role.category !== 'UNKNOWN') {
    return {
      category: role.category,
      roleFamily: role.roleFamily,
      isEngineering: true,
      reason: `role family ${role.roleFamily}`,
    };
  }

  // Title alone was inconclusive: departments and extracted skills are weak secondary signals.
  const dept = (input.departments ?? []).join(' ');
  if (dept) {
    const byDept = classifyRoleFamily(`${title} ${dept}`);
    if (byDept.category !== 'UNKNOWN') {
      return {
        category: byDept.category,
        roleFamily: byDept.roleFamily,
        isEngineering: true,
        reason: `department "${dept.slice(0, 40)}"`,
      };
    }
    if (NON_ENGINEERING_PATTERNS.some((p) => p.test(dept))) {
      return {
        category: 'NON_ENGINEERING',
        roleFamily: 'non_engineering',
        isEngineering: false,
        reason: `department "${dept.slice(0, 40)}"`,
      };
    }
  }

  // Generic engineering fallback: titles like "Staff Engineer", "Solutions Architect" or
  // "Technical Services Engineer" belong to no specific family but are clearly technical.
  // Seniority is *not* decided here — classifyExperience does that separately.
  if (GENERIC_ENGINEERING.test(title)) {
    return {
      category: 'OTHER_ENGINEERING',
      roleFamily: 'unknown',
      isEngineering: true,
      reason: 'generic engineering title',
    };
  }
  const skills = input.skills ?? [];
  if (skills.length >= 4 && /\b(technical|technology)\b/i.test(title)) {
    return {
      category: 'OTHER_ENGINEERING',
      roleFamily: 'unknown',
      isEngineering: true,
      reason: 'technical title with technical skills',
    };
  }
  return { category: 'UNKNOWN', roleFamily: 'unknown', isEngineering: false, reason: 'no match' };
}
