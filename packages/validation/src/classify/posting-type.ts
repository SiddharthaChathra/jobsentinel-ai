import type { PostingType } from '@jobsentinel/types';

/**
 * What kind of hiring a posting is (F3, D114): a college's campus drive, a company's fresher
 * programme open to graduates from anywhere ("off-campus"), or a regular opening.
 *
 * "Campus" alone means nothing: most offices are campuses ("our Bengaluru campus"). A campus
 * drive needs a hiring word next to it; "off-campus" is checked first because it contains
 * "campus drive". A programme needs a fresher word in front of "program(me)", so a "Program
 * Manager" never qualifies.
 */
const OFF_CAMPUS: RegExp[] = [
  /\boff[\s-]?campus\b/i,
  /\b(graduate|trainee|fresher|freshers|early[\s-]careers?|apprentice(ship)?|new[\s-]grad(uate)?)\s+(engineer(ing)?\s+)?(trainee\s+)?(hiring\s+)?program(me)?s?\b/i,
  /\b(fresher|freshers|graduate)\s+(hiring\s+)?drive\b/i,
  /\bhiring\s+challenge\b/i,
  /\bnational\s+qualifier\s+test\b|\bnqt\b/i,
];

const CAMPUS_DRIVE: RegExp[] = [
  /\b(on[\s-]?campus|campus)\s+(drive|recruitment|placements?|hiring|interviews?)\b/i,
  /\bplacement\s+drive\b/i,
  /\b(pool|joint)\s+campus\b/i,
];

export function classifyPostingType(input: { title: string; description: string }): PostingType {
  const text = `${input.title}\n${input.description}`;
  if (OFF_CAMPUS.some((p) => p.test(text))) return 'OFF_CAMPUS_PROGRAM';
  if (CAMPUS_DRIVE.some((p) => p.test(text))) return 'CAMPUS_DRIVE';
  return 'REGULAR';
}
