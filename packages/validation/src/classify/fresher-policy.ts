import type { ExperienceLevel } from '@jobsentinel/types';

/** The most experience a listed job may ask for: "0-1 years" is in, "2+ years" is not (D96). */
export const MAX_FRESHER_MIN_YEARS = 1;

/**
 * Whether a job is one JobSentinel lists: a fresher role, or an entry-level role asking for at
 * most one year (D96). UNKNOWN is not listed — a job is shown only when the rules or the AI could
 * positively place it as fresher or entry level, never as a default.
 */
export function isFresherRole(input: { level: ExperienceLevel; minYears: number | null }): boolean {
  if (input.minYears !== null && input.minYears > MAX_FRESHER_MIN_YEARS) return false;
  return input.level === 'FRESHER' || input.level === 'ENTRY_LEVEL';
}
