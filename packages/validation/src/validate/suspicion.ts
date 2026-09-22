import {
  APPLY_FORM_MARKERS,
  CLOSED_PAGE_MARKERS,
  FRESHER_SALARY_CEILING_INR,
  NEGATION_CONTEXT,
  SUSPICIOUS_PATTERNS,
} from '@jobsentinel/config';
import { isFreemail, isShortener } from './domain';

export interface SuspicionFlag {
  code: string;
  label: string;
  detail: string;
  weight: number;
  hard: boolean;
}

export interface SuspicionInput {
  title: string;
  description: string;
  companyName?: string | null;
  companyDomain?: string | null;
  /** Salary already normalized to INR per year, when known. */
  salaryMaxInr?: number | null;
  /** The ceiling only means anything for a job that claims to be open to freshers. */
  fresherEligible?: boolean | null;
  applicationUrl?: string | null;
  redirectChain?: string[];
  /** Text of the fetched application page, when it was reachable. */
  pageText?: string | null;
}

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const MAX_SCAN = 12_000;

/**
 * Deterministic scam/suspicion detection (docs 08 §3.5). Pure and fully unit-tested:
 * the AI may *add* an opinion later, but these flags are what actually move the score.
 */
export function detectSuspiciousIndicators(input: SuspicionInput): SuspicionFlag[] {
  const haystack = `${input.title}\n${input.description}\n${input.pageText ?? ''}`.slice(
    0,
    MAX_SCAN,
  );
  const flags: SuspicionFlag[] = [];

  for (const p of SUSPICIOUS_PATTERNS) {
    const m = haystack.match(p.pattern);
    if (!m) continue;
    // "We never charge a registration fee" is a warning, not a demand (docs 08 §3.5).
    if (p.honorNegation && isNegated(haystack, m.index ?? 0)) continue;
    flags.push({
      code: p.code,
      label: p.label,
      detail: m[0].replace(/\s+/g, ' ').trim().slice(0, 120),
      weight: p.weight,
      hard: p.hard ?? false,
    });
  }

  // Contact address on a free mail provider while the company has its own domain.
  if (input.companyDomain) {
    const emails = [...new Set(haystack.match(EMAIL_RE) ?? [])];
    const freemail = emails.find((e) => isFreemail(e));
    if (freemail) {
      flags.push({
        code: 'FREEMAIL_CONTACT',
        label: 'Contact address is a free mail account',
        detail: maskEmail(freemail),
        weight: -0.25,
        hard: false,
      });
    }
  }

  // A shortener anywhere in the application redirect chain.
  const urls = [input.applicationUrl, ...(input.redirectChain ?? [])].filter((u): u is string =>
    Boolean(u),
  );
  const shortened = urls.find((u) => isShortener(u));
  if (shortened) {
    flags.push({
      code: 'SHORTENER_IN_CHAIN',
      label: 'Application link goes through a URL shortener',
      detail: shortened.slice(0, 120),
      weight: -0.15,
      hard: false,
    });
  }

  // Salary far beyond any plausible fresher offer.
  if (
    input.fresherEligible === true &&
    input.salaryMaxInr &&
    input.salaryMaxInr > FRESHER_SALARY_CEILING_INR
  ) {
    flags.push({
      code: 'UNREALISTIC_SALARY',
      label: 'Salary is implausible for an entry-level role',
      detail: `₹${Math.round(input.salaryMaxInr / 100_000)} LPA`,
      weight: -0.3,
      hard: false,
    });
  }

  return flags;
}

export interface ClosedMarker {
  code: string;
  detail: string;
}

/** Looks for "this job is closed" wording on a fetched page (docs 08 §3.4). */
export function detectClosedMarkers(pageText: string | null | undefined): ClosedMarker[] {
  if (!pageText) return [];
  const text = pageText.slice(0, MAX_SCAN);
  const out: ClosedMarker[] = [];
  for (const m of CLOSED_PAGE_MARKERS) {
    const match = text.match(m.pattern);
    if (match)
      out.push({ code: m.code, detail: match[0].replace(/\s+/g, ' ').trim().slice(0, 120) });
  }
  return out;
}

/** True when the page looks like it actually offers an application. Absence is not evidence of closure. */
export function hasApplyForm(pageHtml: string | null | undefined): boolean {
  if (!pageHtml) return false;
  const html = pageHtml.slice(0, 200_000);
  return APPLY_FORM_MARKERS.some((p) => p.test(html));
}

/** Looks back to the start of the sentence for a negating word ("we never charge…"). */
function isNegated(text: string, matchIndex: number): boolean {
  const sentenceStart = Math.max(
    0,
    text.lastIndexOf('.', matchIndex) + 1,
    text.lastIndexOf('\n', matchIndex) + 1,
  );
  const before = text.slice(Math.max(sentenceStart, matchIndex - 160), matchIndex);
  return NEGATION_CONTEXT.test(before);
}

function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}
