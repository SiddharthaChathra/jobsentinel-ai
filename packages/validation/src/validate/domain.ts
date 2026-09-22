import { getDomain, getHostname } from 'tldts';
import { FREEMAIL_DOMAINS, KNOWN_ATS_DOMAINS, URL_SHORTENERS } from '@jobsentinel/config';
import type { DomainRelationship } from '@jobsentinel/types';

export interface DomainRelationshipResult {
  relationship: DomainRelationship;
  detail: string;
  /** Contribution to the validation confidence score (docs 08 §3.3). */
  weight: number;
  atsProvider?: string;
  slugMatched?: boolean;
}

export function registrableDomain(url: string): string | null {
  return getDomain(url, { allowPrivateDomains: false });
}

export function hostOf(url: string): string | null {
  return getHostname(url, { allowPrivateDomains: false });
}

export function isKnownAtsHost(url: string): string | null {
  const host = hostOf(url);
  if (!host) return null;
  return KNOWN_ATS_DOMAINS.find((d) => host === d || host.endsWith(`.${d}`)) ?? null;
}

export function isShortener(url: string): boolean {
  const host = hostOf(url);
  return host !== null && URL_SHORTENERS.some((d) => host === d || host.endsWith(`.${d}`));
}

export function isFreemail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  return domain !== undefined && FREEMAIL_DOMAINS.includes(domain);
}

function slugCandidates(companyName: string, atsSlug?: string | null): string[] {
  const out = new Set<string>();
  if (atsSlug) out.add(atsSlug.toLowerCase());
  const normalized = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized) {
    out.add(normalized);
    out.add(normalized.slice(0, 12));
  }
  return [...out].filter((s) => s.length >= 3);
}

/**
 * How the application URL relates to the company (docs 08 §3.3) — the strongest structural
 * evidence available for free. Never claims certainty: it returns a relationship plus a weight.
 */
export function domainRelationship(input: {
  applicationUrl: string;
  companyDomain?: string | null;
  companyName?: string | null;
  atsSlug?: string | null;
}): DomainRelationshipResult {
  const { applicationUrl, companyDomain, companyName, atsSlug } = input;
  const urlHost = hostOf(applicationUrl);
  const urlDomain = registrableDomain(applicationUrl);
  if (!urlHost || !urlDomain)
    return { relationship: 'UNKNOWN', detail: 'application URL has no resolvable host', weight: 0 };

  const ats = isKnownAtsHost(applicationUrl);
  if (ats) {
    const path = safePath(applicationUrl).toLowerCase();
    const candidates = slugCandidates(companyName ?? '', atsSlug);
    const slugMatched = candidates.some((s) => path.includes(s) || urlHost.startsWith(`${s}.`));
    return slugMatched
      ? {
          relationship: 'KNOWN_ATS',
          detail: `${ats} board for "${atsSlug ?? companyName ?? ''}"`,
          weight: 0.3,
          atsProvider: ats,
          slugMatched: true,
        }
      : {
          relationship: 'KNOWN_ATS',
          detail: `${ats} board, company slug not confirmed`,
          weight: 0.15,
          atsProvider: ats,
          slugMatched: false,
        };
  }

  if (!companyDomain)
    return { relationship: 'UNKNOWN', detail: 'company domain unknown', weight: 0 };
  const companyRegistrable =
    registrableDomain(`https://${companyDomain.replace(/^https?:\/\//, '')}`) ??
    companyDomain.toLowerCase();

  if (urlDomain === companyRegistrable) {
    return urlHost === companyRegistrable
      ? { relationship: 'SAME_DOMAIN', detail: `application hosted on ${urlHost}`, weight: 0.3 }
      : {
          relationship: 'SUBDOMAIN',
          detail: `application hosted on ${urlHost} (subdomain of ${companyRegistrable})`,
          weight: 0.3,
        };
  }
  return {
    relationship: 'UNRELATED',
    detail: `application on ${urlDomain}, company domain is ${companyRegistrable}`,
    weight: -0.25,
  };
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

/** Levenshtein distance, capped for speed — used for look-alike domain detection. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
      rowMin = Math.min(rowMin, curr[j]!);
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

/**
 * A domain that is *almost* a known company's domain is a classic impersonation signal
 * (e.g. "razorpay-careers.com" vs "razorpay.com"). Returns the matched known domain, if any.
 */
export function lookalikeOf(candidateDomain: string, knownDomains: string[]): string | null {
  const candidate = candidateDomain.toLowerCase().replace(/^www\./, '');
  const candidateLabel = candidate.split('.')[0] ?? '';
  for (const known of knownDomains) {
    const k = known.toLowerCase().replace(/^www\./, '');
    if (k === candidate) return null; // identical is not a look-alike
    const knownLabel = k.split('.')[0] ?? '';
    // Short brand names collide trivially ("zeta" vs "okta" is distance 2), so only longer
    // labels are compared fuzzily, and the tolerance scales with length.
    if (knownLabel.length < 5) continue;
    if (candidateLabel === knownLabel && candidate !== k) return known; // same brand, different TLD
    const tolerance = knownLabel.length >= 8 ? 2 : 1;
    if (editDistance(candidateLabel, knownLabel, tolerance) <= tolerance) return known;
    if (
      knownLabel.length >= 5 &&
      candidateLabel.includes(knownLabel) &&
      candidateLabel !== knownLabel
    )
      return known; // "razorpay-careers"
  }
  return null;
}
