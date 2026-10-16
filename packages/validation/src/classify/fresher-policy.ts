import type { ExperienceLevel } from '@jobsentinel/types';

/**
 * The minimum experience a listed job may ask for. Only zero: a fresher has none, so a posting
 * is listed when it accepts zero — "0-2", "0-5" or "0-10 years" alike, whatever the upper end
 * (D96, revised). "1-3 years" asks for experience a fresher does not have.
 */
export const MAX_FRESHER_MIN_YEARS = 0;

/**
 * Whether a job is one JobSentinel lists (D96):
 * - it states a minimum of zero years, unless it is clearly senior (a "Senior" title beats a
 *   contradictory "0-5 years"); or
 * - it states no years and the rules or the AI placed it as fresher or entry level.
 * UNKNOWN with no stated years is not listed: it is shown only once the AI places it.
 */
export function isFresherRole(input: { level: ExperienceLevel; minYears: number | null }): boolean {
  if (input.minYears !== null) {
    return input.minYears <= MAX_FRESHER_MIN_YEARS && input.level !== 'EXPERIENCED';
  }
  return input.level === 'FRESHER' || input.level === 'ENTRY_LEVEL';
}
