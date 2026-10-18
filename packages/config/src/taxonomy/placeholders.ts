/**
 * Titles of postings that are not jobs: general applications, talent pools, "join our network"
 * (D117). Matched against the title only. Each pattern needs the whole phrase — "General
 * Application", not "general" — so a real "General Engineer" or "General Manager" never matches.
 * Add a phrase here, with a test for it and for a real title it must not catch.
 */
export const PLACEHOLDER_TITLE_PATTERNS: RegExp[] = [
  // "Don't see what you're looking for?", "Don’t see the right role?"
  /\bdon['’]?t see (what|the right|a|an|your)\b/i,
  /\bnot seeing (what|the right|a|an)\b/i,
  /\bgeneral (application|applications|interest|submission|consideration)\b/i,
  /\b(open|spontaneous|unsolicited|speculative) (application|applications)\b/i,
  /\btalent (community|network|pool|pipeline)\b/i,
  /\bfuture (opportunities|opportunity|openings|roles|positions|vacancies|talent)\b/i,
  /\bjoin (our|the) (talent )?(network|community|talent pool)\b/i,
  /\bexpression of interest\b/i,
  /\b(submit|send|drop|share) (us )?(your|a) (resume|cv|profile)\b/i,
];
