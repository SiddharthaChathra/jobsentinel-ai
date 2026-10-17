import type { AIPurpose } from './provider';

/**
 * Who gets the shared daily AI budget when it runs low (F8, D105). Lower number = more
 * important. Each tier may spend only while today's usage is under its ceiling, so a
 * low-priority purpose stops early and leaves the rest of the day's budget to the ones above
 * it — resume parsing is never starved by matching, and the category check comes last.
 */
export const AI_PURPOSE_PRIORITY: Record<AIPurpose, 1 | 2 | 3 | 4 | 5> = {
  RESUME_PROFILE: 1,
  FRESHER_CLASSIFY: 2,
  MATCH: 3,
  JOB_REQUIREMENTS: 4,
  SUSPICION: 4,
  CATEGORY_CLASSIFY: 5,
};

/** Share of the daily call AND token budget a tier may use, measured across all purposes. */
export const PRIORITY_CEILING: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 1.0,
  2: 0.9,
  3: 0.8,
  4: 0.7,
  5: 0.6,
};

export interface BudgetUse {
  calls: number;
  tokens: number;
}

/** Whether `purpose` may make another call given today's usage across every purpose. */
export function allowedUnderPriority(
  purpose: AIPurpose,
  used: BudgetUse,
  budget: BudgetUse,
): boolean {
  const ceiling = PRIORITY_CEILING[AI_PURPOSE_PRIORITY[purpose]];
  return used.calls < budget.calls * ceiling && used.tokens < budget.tokens * ceiling;
}
