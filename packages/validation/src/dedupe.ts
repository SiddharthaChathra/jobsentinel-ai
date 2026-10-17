import { createHash } from 'node:crypto';
import { normalizeCompanyName } from './normalize/company';
import { normalizeTitle } from './normalize/title';

/**
 * Tokens that vary between otherwise identical postings and must not affect the dedupe key.
 * Level markers (1/2/3, I/II/III, L1/L2, senior/junior) are deliberately KEPT: for a fresher,
 * "Software Engineer 1" and "Software Engineer 3" are different jobs.
 */
const NOISE = new Set([
  'new',
  'urgent',
  'hiring',
  'immediate',
  'joiner',
  'joiners',
  'opening',
  'openings',
  'position',
  'positions',
  'the',
  'a',
  'an',
  'of',
  'for',
  'and',
  'in',
  'at',
  'to',
  '&',
  'fresher',
  'freshers',
  '2025',
  '2026',
  '2027',
  'batch',
  'campus',
]);

/** Title reduced to its sorted content tokens; "Software Engineer - Fresher (2026 batch)" ≈ "software engineer". */
export function dedupeTitleKey(title: string): string {
  return normalizeTitle(title)
    .split(' ')
    .filter((w) => w && !NOISE.has(w))
    .sort()
    .join(' ');
}

export function locationKey(
  city: string | null,
  country: string | null,
  isRemote: boolean,
): string {
  if (city) return city.toLowerCase();
  if (isRemote) return 'remote';
  return (country ?? '').toLowerCase();
}

/** sha1(company | title | location) — the exact-match dedupe key (docs 06 §6 step 3). */
export function computeDedupeKey(input: {
  company: string;
  title: string;
  city: string | null;
  country: string | null;
  isRemote: boolean;
}): string {
  const raw = [
    normalizeCompanyName(input.company),
    dedupeTitleKey(input.title),
    locationKey(input.city, input.country, input.isRemote),
  ].join('|');
  return createHash('sha1').update(raw).digest('hex');
}

/** Detects edits to an already-known posting (description/requirements/URL). */
export function contentHash(parts: (string | null | undefined)[]): string {
  return createHash('sha256')
    .update(parts.map((p) => (p ?? '').trim().toLowerCase()).join('\u0001'))
    .digest('hex');
}

// ── SimHash (64-bit) ──────────────────────────────────────────────────────────
function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9+#. ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
  // Unigrams only: a changed word touches exactly one feature, so a 2–3 word edit stays within
  // the ≤ 6 Hamming threshold (docs D21). Order is deliberately ignored — title similarity is
  // checked separately before a fuzzy merge.
  return words;
}

function hash64(s: string): bigint {
  const h = createHash('md5').update(s).digest();
  return h.readBigUInt64BE(0);
}

/** 64-bit SimHash of the text; near-duplicate descriptions have small Hamming distance. */
export function simhash(text: string): bigint {
  const tokens = tokenize(text);
  if (tokens.length === 0) return 0n;
  const v = new Array<number>(64).fill(0);
  for (const t of tokens) {
    const h = hash64(t);
    for (let i = 0; i < 64; i++) v[i] = (v[i] ?? 0) + ((h >> BigInt(i)) & 1n ? 1 : -1);
  }
  let out = 0n;
  for (let i = 0; i < 64; i++) if (v[i]! > 0) out |= 1n << BigInt(i);
  return out;
}

export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x) {
    x &= x - 1n;
    count++;
  }
  return count;
}

/** Postgres bigint is signed; store the unsigned 64-bit value via two's complement. */
export function simhashToSigned(h: bigint): bigint {
  return h >= 1n << 63n ? h - (1n << 64n) : h;
}
export function simhashFromSigned(s: bigint): bigint {
  return s < 0n ? s + (1n << 64n) : s;
}

/** Jaccard similarity of title token sets (0..1). */
export function titleSimilarity(a: string, b: string): number {
  const A = new Set(dedupeTitleKey(a).split(' ').filter(Boolean));
  const B = new Set(dedupeTitleKey(b).split(' ').filter(Boolean));
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * A description this short is a board's preview, not the posting: Adzuna returns ~500 characters
 * (D113). Same bound the category prompt uses to tell the AI it is reading a preview.
 */
export const PREVIEW_MAX_CHARS = 600;

export interface PreviewSide {
  title: string;
  city: string | null;
  descriptionLength: number;
}

/**
 * Cross-source duplicate when one copy is only a preview (F3, D113). SimHash cannot match a
 * 500-character excerpt against the full posting, so an aggregator's copy and the company
 * board's copy of one job became two jobs. Within one company (the caller's scope) they are the
 * same job when the titles reduce to the same tokens and the cities do not contradict: level
 * markers survive `dedupeTitleKey`, so "Software Engineer" never merges with "Senior Software
 * Engineer", and two named cities that differ stay two openings, as the exact key has them.
 */
export function isPreviewDuplicate(a: PreviewSide, b: PreviewSide): boolean {
  if (Math.min(a.descriptionLength, b.descriptionLength) > PREVIEW_MAX_CHARS) return false;
  const key = dedupeTitleKey(a.title);
  if (!key || key !== dedupeTitleKey(b.title)) return false;
  const ca = a.city?.trim().toLowerCase() || null;
  const cb = b.city?.trim().toLowerCase() || null;
  return ca === null || cb === null || ca === cb;
}
