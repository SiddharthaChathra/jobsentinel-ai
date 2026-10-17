import {
  GRADUATE_TRAINEE_FAMILY,
  ROLE_FAMILIES,
  TRAINEE_QUALIFIERS,
  UNKNOWN_ROLE_FAMILY,
  type RoleFamily,
} from '@jobsentinel/config';
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
      if (family.key === GRADUATE_TRAINEE_FAMILY) {
        // A programme title: the discipline, if any, is in its qualifier (D109).
        const q = TRAINEE_QUALIFIERS.find((x) => x.pattern.test(t));
        const byQualifier = q && ROLE_FAMILIES.find((f) => f.key === q.familyKey);
        if (byQualifier) {
          return {
            roleFamily: byQualifier.key,
            category: byQualifier.category,
            matchedFamily: byQualifier,
          };
        }
      }
      return { roleFamily: family.key, category: family.category, matchedFamily: family };
    }
  }
  return { roleFamily: UNKNOWN_ROLE_FAMILY, category: 'UNKNOWN', matchedFamily: null };
}
