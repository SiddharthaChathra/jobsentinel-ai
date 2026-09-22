import { ROLE_FAMILIES, UNKNOWN_ROLE_FAMILY, type RoleFamily } from '@jobsentinel/config';
import type { JobCategory } from '@jobsentinel/types';
import { normalizeTitle } from '../normalize/title';

export interface RoleClassification {
  roleFamily: string;
  category: JobCategory;
  matchedFamily: RoleFamily | null;
}

/** Deterministic title → role family/category. Returns `unknown`/`UNKNOWN` when nothing matches. */
export function classifyRoleFamily(title: string): RoleClassification {
  const t = normalizeTitle(title);
  for (const family of ROLE_FAMILIES) {
    if (family.patterns.some((p) => p.test(t))) {
      return { roleFamily: family.key, category: family.category, matchedFamily: family };
    }
  }
  return { roleFamily: UNKNOWN_ROLE_FAMILY, category: 'UNKNOWN', matchedFamily: null };
}
