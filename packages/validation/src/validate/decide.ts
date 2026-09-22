import type { UrlStatus, ValidationStatus } from '@jobsentinel/types';
import type { SuspicionFlag } from './suspicion';

export interface Evidence {
  check: string;
  passed: boolean;
  weight: number;
  detail?: string;
}

export interface DecisionInput {
  /** Company verification evidence and its total weight (docs 08 §3.2). */
  companyEvidence: Evidence[];
  /** Application-URL evidence: relationship, HTTP status, apply form. */
  urlEvidence: Evidence[];
  urlStatus: UrlStatus;
  suspicionFlags: SuspicionFlag[];
  /** Page said the posting is closed, or the source's own API 404s it. */
  closed: boolean;
  /** Company explicitly blocked by the user. */
  companyBlocked: boolean;
  /** AI opinion, bounded to ±0.2 (docs 08 §3.6). */
  ai?: { verdict: 'LEGIT' | 'SUSPICIOUS' | 'UNSURE'; confidence: number } | null;
}

export interface Decision {
  status: ValidationStatus;
  confidence: number;
  companyVerified: boolean;
  applicationVerified: boolean;
  jobActive: boolean;
  evidence: Evidence[];
  reason: string;
}

const PRIOR = 0.5;
const COMPANY_VERIFIED_AT = 0.5;
const VALID_AT = 0.7;
const SUSPICIOUS_BELOW = 0.35;
/** The AI can never move a job more than this, in either direction (docs 08 §3.6). */
const AI_MAX_EFFECT = 0.2;

/** Application link is on the company own domain/subdomain or a matched ATS board. */
function strongDomainEvidence(urlEvidence: Evidence[]): boolean {
  const rel = urlEvidence.find((e) => e.check === 'URL_DOMAIN_RELATIONSHIP');
  return rel !== undefined && rel.weight >= 0.3;
}

function sum(evidence: Evidence[]): number {
  return evidence.reduce((acc, e) => acc + e.weight, 0);
}

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Combines every signal into a status + confidence (docs 08 §4).
 * Rules decide; the AI only nudges. Ambiguity becomes NEEDS_REVIEW — never a silent VALID.
 */
export function decideValidation(input: DecisionInput): Decision {
  const evidence: Evidence[] = [
    ...input.companyEvidence,
    ...input.urlEvidence,
    ...input.suspicionFlags.map((f) => ({
      check: f.code,
      passed: false,
      weight: f.weight,
      detail: f.detail,
    })),
  ];

  const companyScore = PRIOR + sum(input.companyEvidence);
  const companyVerified = companyScore >= COMPANY_VERIFIED_AT;
  const applicationVerified =
    (input.urlStatus === 'OK' || input.urlStatus === 'REDIRECTED') &&
    input.urlEvidence.some((e) => e.check === 'URL_DOMAIN_RELATIONSHIP' && e.weight > 0);

  let score = clamp(PRIOR + sum(evidence));
  let aiNote = '';
  if (input.ai && input.ai.verdict !== 'UNSURE') {
    const delta =
      Math.min(AI_MAX_EFFECT, AI_MAX_EFFECT * input.ai.confidence) *
      (input.ai.verdict === 'LEGIT' ? 1 : -1);
    score = clamp(score + delta);
    evidence.push({
      check: 'AI_ASSESSMENT',
      passed: input.ai.verdict === 'LEGIT',
      weight: delta,
      detail: `${input.ai.verdict} (${input.ai.confidence.toFixed(2)})`,
    });
    aiNote = `, AI ${input.ai.verdict.toLowerCase()}`;
  }

  const hardFlag = input.suspicionFlags.find((f) => f.hard);

  if (input.companyBlocked) {
    return done('INVALID', score, 'company is blocked by the user');
  }
  if (input.closed || input.urlStatus === 'NOT_FOUND' || input.urlStatus === 'CLOSED') {
    return done(
      'EXPIRED',
      score,
      input.closed ? 'the posting says it is closed' : 'application URL returns not found',
    );
  }
  if (hardFlag) {
    return done(
      'SUSPICIOUS',
      Math.min(score, 0.3),
      `scam indicator: ${hardFlag.label.toLowerCase()}`,
    );
  }
  if (
    score >= VALID_AT &&
    companyVerified &&
    (input.urlStatus === 'OK' || input.urlStatus === 'REDIRECTED')
  ) {
    return done('VALID', score, `company and application link verified${aiNote}`);
  }
  // Bot protection (403/429) on a verified company's own domain or ATS board is not evidence of
  // anything wrong — docs 08 §3.3. The job stays VALID but with the page-check caveat recorded,
  // and confidence capped so it never outranks a fully checked posting.
  if (
    input.urlStatus === 'BLOCKED' &&
    companyVerified &&
    score >= VALID_AT &&
    strongDomainEvidence(input.urlEvidence) &&
    input.suspicionFlags.length === 0
  ) {
    return done(
      'VALID',
      Math.min(score, 0.8),
      `company verified and the link is on its own careers domain; the page itself refused automated checks${aiNote}`,
    );
  }
  if (score < SUSPICIOUS_BELOW) {
    return done('SUSPICIOUS', score, `weak or negative evidence${aiNote}`);
  }
  // NEEDS_REVIEW means "we could not confirm" — never report near-certain confidence next to it.
  score = Math.min(score, 0.65);
  return done(
    'NEEDS_REVIEW',
    score,
    !companyVerified
      ? 'company could not be verified'
      : input.urlStatus === 'BLOCKED'
        ? 'application page could not be checked (blocked)'
        : input.urlStatus === 'TIMEOUT' || input.urlStatus === 'ERROR'
          ? 'application page could not be reached'
          : `not enough positive evidence${aiNote}`,
  );

  function done(status: ValidationStatus, confidence: number, reason: string): Decision {
    return {
      status,
      confidence: Number(confidence.toFixed(2)),
      companyVerified,
      applicationVerified,
      jobActive: status !== 'EXPIRED',
      evidence,
      reason,
    };
  }
}

/** Re-check cadence for an active job: 6 h → 24 h → 72 h, then every 72 h (docs 07 §1.5). */
export function nextCheckDelayMs(checkCount: number): number {
  const hours = checkCount <= 0 ? 6 : checkCount === 1 ? 24 : 72;
  return hours * 3600_000;
}
