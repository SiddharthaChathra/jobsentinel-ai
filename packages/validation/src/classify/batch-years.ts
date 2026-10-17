/**
 * Every graduation batch a posting names (F3, D107): "2025/2026/2027 batch", "2026/27 batch",
 * "2024-2027 passouts", "Class of 2027", "graduating in 2026 or 2027", "batches of 2026 & 2027".
 * Returns null when the posting names no batch — then no batch gate applies.
 *
 * A bare year elsewhere ("founded in 2025") is ignored: a year counts only when it is attached to a
 * batch word. Two-digit years after a full one take its century ("2026/27" → 2026, 2027); a hyphen
 * or "to" between two years is a range.
 */
const YEAR = String.raw`(?:20\d{2}|'?\d{2})`;
const SEP = String.raw`\s*(?:\/|,|&|\+|and|or|to|-|–)\s*`;
const BATCH_WORD = String.raw`(?:batch(?:es)?|pass\s?-?\s?outs?|graduates?|grads?|freshers)`;

const PATTERNS: RegExp[] = [
  // "2025/2026/2027 batch", "2026/27 passouts", "2024-2027 graduates", "2027 freshers"
  new RegExp(String.raw`\b(20\d{2}(?:${SEP}${YEAR})*)\s*${BATCH_WORD}\b`, 'gi'),
  // "batch of 2026 & 2027", "batches 2026, 2027", "batch: 2027"
  new RegExp(String.raw`\bbatch(?:es)?\s*(?:of|:|-)?\s*(20\d{2}(?:${SEP}${YEAR})*)`, 'gi'),
  // "class of 2027"
  new RegExp(String.raw`\bclass\s+of\s+(20\d{2}(?:${SEP}${YEAR})*)`, 'gi'),
  // "graduating in 2026 or 2027", "graduated in 2025"
  new RegExp(
    String.raw`\bgraduat(?:ing|ed|ion)\s+(?:in\s+|year\s*:?\s*)?(20\d{2}(?:${SEP}${YEAR})*)`,
    'gi',
  ),
  // "freshers (2026/27)", "freshers 2026/27" — the year list right after the word
  new RegExp(String.raw`\bfreshers?\s*\(?\s*(20\d{2}(?:${SEP}${YEAR})*)`, 'gi'),
];

function expandList(list: string): number[] {
  const tokens = list.split(new RegExp(`(${SEP})`, 'i'));
  const years: number[] = [];
  let century = 2000;
  let rangeFrom: number | null = null;
  for (const token of tokens) {
    const t = token.trim().replace(/^'/, '');
    if (!t) continue;
    if (/^(-|–|to)$/i.test(t)) {
      rangeFrom = years.at(-1) ?? null;
      continue;
    }
    if (!/^\d{2}(\d{2})?$/.test(t)) continue;
    let year = Number(t);
    if (t.length === 4) century = Math.floor(year / 100) * 100;
    else year = century + year;
    if (year < 2000 || year > 2099) continue;
    if (rangeFrom !== null && year > rangeFrom && year - rangeFrom <= 6) {
      for (let y = rangeFrom + 1; y <= year; y++) years.push(y);
    } else {
      years.push(year);
    }
    rangeFrom = null;
  }
  return years;
}

export function extractBatchYears(text: string): number[] | null {
  const found = new Set<number>();
  for (const pattern of PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      for (const y of expandList(m[1] ?? '')) found.add(y);
    }
  }
  return found.size === 0 ? null : [...found].sort((a, b) => a - b);
}

/**
 * Eligible when the posting names no batch, when the user's year is unknown, or when the user's
 * year is among the batches it names. "2025 passouts only" excludes a 2027 graduate; "2025/2026/2027"
 * includes them (D107).
 */
export function isBatchEligible(jobYears: number[] | null, graduationYear: number | null): boolean {
  if (jobYears === null || graduationYear === null) return true;
  return jobYears.includes(graduationYear);
}
