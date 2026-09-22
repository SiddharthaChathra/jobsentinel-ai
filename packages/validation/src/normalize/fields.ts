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
 * Extracts an experience range from free text: "0-2 years", "2+ yrs", "minimum 3 years",
 * "fresher", "0 to 1 year". Returns the first, most specific match.
 */
export function parseExperience(...hints: (string | null | undefined)[]): ParsedExperience {
  const text = hints.filter(Boolean).join(' \n ');
  if (!text) return { minYears: null, maxYears: null, text: null };
  const t = text.toLowerCase();

  const range = t.match(new RegExp(`(\\d{1,2})\\s*(?:-|–|to)\\s*(\\d{1,2})\\+?\\s*${YEAR_WORDS}`));
  if (range)
    return { minYears: Number(range[1]), maxYears: Number(range[2]), text: range[0].trim() };

  const plus = t.match(new RegExp(`(\\d{1,2})\\s*\\+\\s*${YEAR_WORDS}`));
  if (plus) return { minYears: Number(plus[1]), maxYears: null, text: plus[0].trim() };

  const minimum = t.match(
    new RegExp(
      `(?:minimum|min\\.?|at least|atleast|over|more than)\\s*(?:of\\s*)?(\\d{1,2})\\s*${YEAR_WORDS}`,
    ),
  );
  if (minimum) return { minYears: Number(minimum[1]), maxYears: null, text: minimum[0].trim() };

  const upTo = t.match(
    new RegExp(`(?:up to|upto|maximum|max\\.?|less than|under)\\s*(\\d{1,2})\\s*${YEAR_WORDS}`),
  );
  if (upTo) return { minYears: 0, maxYears: Number(upTo[1]), text: upTo[0].trim() };

  const exact = t.match(
    new RegExp(
      `(\\d{1,2})\\s*${YEAR_WORDS}(?:\\s*(?:of)?\\s*(?:relevant|professional|industry|work|hands[- ]on)?\\s*experience)`,
    ),
  );
  if (exact)
    return { minYears: Number(exact[1]), maxYears: Number(exact[1]), text: exact[0].trim() };

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
  const t = text.replace(/\s+/g, ' ');
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
