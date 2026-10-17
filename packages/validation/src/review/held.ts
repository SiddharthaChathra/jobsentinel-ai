import type { HeldInfo } from '@jobsentinel/types';

/** Job boards whose application links lead to their own pages, not the employer's (C1, D106). */
const BOARD_HOSTS = /(^|\.)adzuna\.[a-z.]+$/i;

/**
 * Why a NEEDS_REVIEW job is held, in words a user can act on (C step 2, D106). `reason` is the
 * latest HELD (classification) or VALIDATED (verification) reason; `finalUrl` is where the
 * application link ended up, when verification ran.
 */
export function heldInfo(reason: string | null, finalUrl: string | null): HeldInfo {
  const r = reason ?? '';
  if (/^category unknown/i.test(r)) {
    if (/experience unknown/i.test(r)) {
      return {
        kind: 'CATEGORY_UNKNOWN',
        label:
          'Category and experience unclear: the posting says neither what the work is nor how much experience it needs',
        reason: r,
      };
    }
    return {
      kind: 'CATEGORY_UNKNOWN',
      label: /no AI verdict/i.test(r)
        ? 'Category not known yet: the AI has not been able to answer'
        : 'Category unclear: the posting does not say what kind of work it is',
      reason: r,
    };
  }
  if (/^experience unknown/i.test(r)) {
    // Held, not filtered, at the owner's request (R2, D110): India, batch and recency still apply.
    return {
      kind: 'EXPERIENCE_UNKNOWN',
      label: 'Experience not stated: the posting does not say whether freshers can apply',
      reason: r,
    };
  }
  if (/company could not be verified/i.test(r)) {
    let host: string;
    try {
      host = finalUrl ? new URL(finalUrl).hostname : '';
    } catch {
      host = '';
    }
    return {
      kind: 'COMPANY_UNVERIFIED',
      label: BOARD_HOSTS.test(host)
        ? 'Company not verified: the job board links only to its own page, not the employer'
        : 'Company not verified: the application link is not on the employer’s website',
      reason: r,
    };
  }
  if (/could not be reached|unreachable|timed out|http \d{3}/i.test(r)) {
    return { kind: 'URL_UNREACHABLE', label: 'Application page could not be reached', reason: r };
  }
  return { kind: 'OTHER', label: r ? `Held for review: ${r}` : 'Held for review', reason: r };
}
