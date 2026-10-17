import type { EmploymentType } from '@jobsentinel/types';

// ── employment type ───────────────────────────────────────────────────────────
export function parseEmploymentType(...hints: (string | null | undefined)[]): EmploymentType {
  const text = hints.filter(Boolean).join(' ').toLowerCase();
  if (!text) return 'UNKNOWN';
  if (/\bintern(ship)?s?\b/.test(text)) return 'INTERNSHIP';
  if (/\b(trainee|apprentice(ship)?|graduate (engineer|trainee) programme?)\b/.test(text))
    return 'TRAINEE';
  if (/\b(contract|contractor|freelance|temporary|temp|fixed[- ]term)\b/.test(text))
    return 'CONTRACT';
  if (/\bpart[- ]?time\b/.test(text)) return 'PART_TIME';
  if (/\b(full[- ]?time|permanent|regular)\b/.test(text)) return 'FULL_TIME';
  return 'UNKNOWN';
}

// ── experience ────────────────────────────────────────────────────────────────
export interface ParsedExperience {
  minYears: number | null;
  maxYears: number | null;
  text: string | null;
}

const YEAR_WORDS = '(?:years?|yrs?|y)';

/**
 * Above this, a "required experience" figure is a parse error, not a requirement (D116): what
 * real postings put there is company history — "over 80 years as an industrial leader", "more
 * than 60 years since SYSTRA…", Thoughtworks' "For 30+ years, we've…" on every posting.
 */
export const MAX_PLAUSIBLE_EXPERIENCE_YEARS = 15;

/** Wording that makes a nearby "N years" a requirement rather than a fact about the company. */
const REQUIREMENT_WORDS =
  /\b(experience|experienced|exp|work(ing)?|relevant|professional|industry|hands[- ]on|minimum|min|at ?least|required|requires?|requirement|must|need(ed|s)?|looking for|candidates?|background|proficien\w*)\b/;

/** Right after the figure: the sentence is about the company ("…years, we've…", "…helping…"). */
const COMPANY_HISTORY_AFTER =
  /^[^.\n]{0,40}?\b(we(['’](ve|re)| have| are)|helping|serving|delivering|since|as an? (\w+ ){0,3}(leader|company|provider|partner)|in business|of excellence|of innovation|of (our )?(history|heritage|legacy))\b/;

type ExperienceCandidate = { min: number; max: number | null; text: string; index: number };

/** Every match of one pattern, in text order. */
function candidates(
  t: string,
  pattern: string,
  read: (m: RegExpMatchArray) => { min: number; max: number | null },
): ExperienceCandidate[] {
  return [...t.matchAll(new RegExp(pattern, 'g'))].map((m) => ({
    ...read(m),
    text: m[0].trim(),
    index: m.index ?? 0,
  }));
}

/**
 * Extracts an experience range from free text: "0-2 years", "2+ yrs", "minimum 3 years",
 * "fresher", "0 to 1 year". Patterns are tried most specific first; within a pattern, the first
 * match that reads as a requirement wins (D116): its minimum is at most
 * `MAX_PLAUSIBLE_EXPERIENCE_YEARS`, requirement wording sits next to it (the source's own
 * experience field, the first hint, needs none), and it is not followed by company history.
 */
export function parseExperience(...hints: (string | null | undefined)[]): ParsedExperience {
  const parts = hints.filter(Boolean) as string[];
  const text = parts.join(' \n ');
  if (!text) return { minYears: null, maxYears: null, text: null };
  const t = text.toLowerCase();
  // The structured experience field, when the source gave one: it is about experience already.
  const fieldEnd = hints[0] ? hints[0].length : 0;

  const plausible = (c: ExperienceCandidate): boolean => {
    if (c.min > MAX_PLAUSIBLE_EXPERIENCE_YEARS) return false;
    const end = c.index + c.text.length;
    if (COMPANY_HISTORY_AFTER.test(t.slice(end, end + 60))) return false;
    if (c.index < fieldEnd) return true;
    const around = `${t.slice(Math.max(0, c.index - 40), c.index)} ${c.text} ${t.slice(end, end + 40)}`;
    return REQUIREMENT_WORDS.test(around);
  };

  const ordered: ExperienceCandidate[][] = [
    candidates(t, String.raw`(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\+?\s*${YEAR_WORDS}\b`, (m) => ({
      min: Number(m[1]),
      max: Number(m[2]),
    })),
    candidates(t, String.raw`(\d{1,2})\s*\+\s*${YEAR_WORDS}\b`, (m) => ({
      min: Number(m[1]),
      max: null,
    })),
    candidates(
      t,
      String.raw`(?:minimum|min\.?|at least|atleast|over|more than)\s*(?:of\s*)?(\d{1,2})\s*${YEAR_WORDS}\b`,
      (m) => ({ min: Number(m[1]), max: null }),
    ),
    candidates(
      t,
      String.raw`(?:up to|upto|maximum|max\.?|less than|under)\s*(\d{1,2})\s*${YEAR_WORDS}\b`,
      (m) => ({ min: 0, max: Number(m[1]) }),
    ),
    candidates(
      t,
      String.raw`(\d{1,2})\s*${YEAR_WORDS}(?:\s*(?:of)?\s*(?:relevant|professional|industry|work|hands[- ]on)?\s*experience)`,
      (m) => ({ min: Number(m[1]), max: Number(m[1]) }),
    ),
  ];
  for (const list of ordered) {
    const hit = list.find(plausible);
    if (hit) return { minYears: hit.min, maxYears: hit.max, text: hit.text };
  }

  if (
    /\b(fresher|freshers|fresh graduate|no (prior )?experience (required|needed|necessary)|0 years?)\b/.test(
      t,
    )
  ) {
    return { minYears: 0, maxYears: 0, text: 'fresher' };
  }
  return { minYears: null, maxYears: null, text: null };
}

// ── salary ────────────────────────────────────────────────────────────────────
export interface ParsedSalary {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: 'YEAR' | 'MONTH' | 'HOUR' | null;
  text: string | null;
  /** true when the currency was inferred from context rather than stated */
  currencyInferred: boolean;
}

const CURRENCY_TOKENS: [RegExp, string][] = [
  [/₹|\binr\b|\brs\.?\b|\brupees?\b|\blpa\b|\blakhs?\b|\blacs?\b|\bcrores?\b/i, 'INR'],
  [/\$|\busd\b|\bdollars?\b/i, 'USD'],
  [/€|\beur\b|\beuros?\b/i, 'EUR'],
  [/£|\bgbp\b|\bpounds?\b/i, 'GBP'],
  [/\bsgd\b/i, 'SGD'],
  [/\baed\b/i, 'AED'],
  [/\bcad\b/i, 'CAD'],
  [/\baud\b/i, 'AUD'],
];

function toNumber(raw: string, unit: string | undefined): number {
  const n = Number(raw.replace(/,/g, ''));
  const u = (unit ?? '').toLowerCase();
  if (/^(lpa|lakhs?|lacs?|l)$/.test(u)) return n * 100_000;
  if (/^(crores?|cr)$/.test(u)) return n * 10_000_000;
  if (/^k$/.test(u)) return n * 1_000;
  if (/^(m|million)$/.test(u)) return n * 1_000_000;
  return n;
}

/** "₹6-8 LPA", "6 to 8 lakhs per annum", "$80,000 - $100,000 / year", "25k/month". Never invents a number. */
export function parseSalary(
  text: string | null | undefined,
  opts: { countryHint?: string | null } = {},
): ParsedSalary {
  const empty: ParsedSalary = {
    min: null,
    max: null,
    currency: null,
    period: null,
    text: null,
    currencyInferred: false,
  };
  if (!text) return empty;
  // "401(k)", "401k" and "403(b)" are benefits, not pay. Left in, the bare number is parsed as a
  // salary and 222 live jobs ended up advertising "401" (D60).
  const t = text.replace(/\s+/g, ' ').replace(/\b40[13]\s*\(?[kb]\)?\b/gi, ' ');
  const unit = '(lpa|lakhs?|lacs?|crores?|cr|k|m|million|l)?';
  const num = '(\\d{1,3}(?:,\\d{2,3})*(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)';
  const range = new RegExp(
    `${num}\\s*${unit}\\s*(?:-|–|to)\\s*(?:[₹$€£]\\s*)?${num}\\s*${unit}`,
    'i',
  );
  const single = new RegExp(`${num}\\s*${unit}`, 'i');

  let min: number | null = null;
  let max: number | null = null;
  let matched: string | null = null;
  const r = t.match(range);
  if (r) {
    min = toNumber(r[1]!, r[2] ?? r[4]);
    max = toNumber(r[3]!, r[4] ?? r[2]);
    matched = r[0];
  } else {
    const s = t.match(single);
    if (s) {
      min = toNumber(s[1]!, s[2]);
      max = min;
      matched = s[0];
    }
  }
  if (min === null) return empty;

  let currency: string | null = null;
  for (const [re, code] of CURRENCY_TOKENS) {
    if (re.test(t)) {
      currency = code;
      break;
    }
  }
  let currencyInferred = false;
  if (!currency && opts.countryHint === 'India') {
    currency = 'INR';
    currencyInferred = true;
  }

  let period: ParsedSalary['period'] = null;
  if (
    /\b(lpa|per annum|p\.a\.|annual|annually|a year|yearly|ctc)\b|\/\s*(year|yr|annum)\b/i.test(t)
  )
    period = 'YEAR';
  else if (/\b(per month|monthly|a month|pm)\b|\/\s*(month|mo)\b/i.test(t)) period = 'MONTH';
  else if (/\b(per hour|hourly)\b|\/\s*(hr|hour)\b/i.test(t)) period = 'HOUR';
  else if (currency === 'INR' && min >= 100_000) period = 'YEAR';

  // Sanity: tiny INR yearly numbers (e.g. "6" without a unit) are meaningless.
  if (currency === 'INR' && period === 'YEAR' && max !== null && max < 50_000)
    return { ...empty, text: matched };

  // A bare small number is almost never pay. Only believe it when a period makes it plausible
  // (an hourly or monthly rate), otherwise it is a stray figure from the description — a team
  // size, a percentage, a footnote — and showing it as a salary is worse than showing nothing.
  const plausibleSmall = period === 'HOUR' ? min >= 5 : period === 'MONTH' ? min >= 1_000 : false;
  if (min < 1_000 && !plausibleSmall) return { ...empty, text: null };

  // …and a figure in the millions is a funding round or a revenue target, not pay. Descriptions
  // say things like "raised $20 million", and that was reaching job cards as a salary (D60).
  // INR is allowed a far higher ceiling because a real CTC is quoted in lakhs.
  const ceiling = currency === 'INR' ? 100_000_000 : 2_000_000;
  if (min > ceiling) return { ...empty, text: null };

  return { min, max, currency, period, text: matched, currencyInferred };
}

// ── URLs ──────────────────────────────────────────────────────────────────────
// NOTE: gh_jid / ashby_jid / lever job ids are IDENTIFIERS on embedded boards — never strip them.
const TRACKING_PARAMS =
  /^(utm_\w+|gh_src|lever-source|lever-origin|ref|source|src|fbclid|gclid|mc_cid|mc_eid|_hsenc|_hsmi|igshid)$/i;

/** Absolute, https-normalized, tracking params stripped, trailing slash trimmed. Returns null when unusable. */
export function cleanUrl(raw: string | null | undefined, base?: string): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim(), base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  let out = url.toString();
  if (out.endsWith('/') && url.pathname !== '/') out = out.slice(0, -1);
  if (out.endsWith('?')) out = out.slice(0, -1);
  return out;
}

// ── HTML → text ───────────────────────────────────────────────────────────────
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
  '#x27': "'",
  '#8211': '–',
  '#8212': '—',
  '#8226': '•',
};

/** Dependency-free HTML to plain text: block tags become newlines, list items bullets, entities decoded. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(
      /<\s*\/\s*(p|div|li|ul|ol|h[1-6]|tr|section|article|header|footer|blockquote|pre|table)\s*>/gi,
      '\n',
    )
    .replace(/<\s*(p|div|h[1-6]|tr|section|article|blockquote|pre|table)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = s.replace(/&(#?\w+);/g, (m, e: string) => {
    if (ENTITIES[e] !== undefined) return ENTITIES[e];
    if (/^#\d+$/.test(e)) return String.fromCodePoint(Number(e.slice(1)));
    if (/^#x[0-9a-f]+$/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2), 16));
    return m;
  });
  return s
    .replace(/\r/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
