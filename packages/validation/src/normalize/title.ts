/**
 * Normalize a job title for comparison and dedupe keys.
 * Lowercases, strips punctuation/brackets, collapses whitespace and expands a few common
 * abbreviations. Seniority tokens are intentionally KEPT here (they matter for classification);
 * `dedupeTitleKey()` (Phase 4) strips them.
 */
const ABBREVIATIONS: Record<string, string> = {
  sde: 'software development engineer',
  swe: 'software engineer',
  sr: 'senior',
  jr: 'junior',
  ml: 'machine learning',
};

export function normalizeTitle(raw: string): string {
  let t = raw.toLowerCase();
  t = t.replace(/\(.*?\)|\[.*?\]/g, ' '); // drop bracketed qualifiers e.g. "(Remote)"
  t = t.replace(/[^a-z0-9+#./ -]/g, ' '); // keep c++, c#, .net, ci/cd
  t = t.replace(/\s*[-/|]\s*/g, ' ');
  t = t.replace(/\.(?=\s|$)/g, ''); // trailing dots ("Sr.") but keep ".net"
  t = t.replace(/\s+/g, ' ').trim();
  t = t
    .split(' ')
    .map((w) => ABBREVIATIONS[w] ?? w)
    .join(' ');
  return t;
}
