import {
  RejectReason,
  type ExperienceLevel,
  type JobStatus,
  type SourceHealth,
  type SourceStatus,
  type ValidationStatus,
} from '@jobsentinel/types';
import { isFresherRole } from '../classify/fresher-policy';

/**
 * Source report card and auto-pause (F2, D103). Pure: the API fetches rows and these decide.
 */

/** A job is listable only inside this window (D73); the report counts the same way. */
export const RECENCY_WINDOW_DAYS = 60;
/** How long a source must collect without keeping anything before it is paused. */
export const AUTO_PAUSE_DAYS = 30;

/** Statuses the job list shows (mirrors the API's LISTABLE). */
const LISTABLE: readonly JobStatus[] = [
  'VALID',
  'NEEDS_REVIEW',
  'MATCHED',
  'NOTIFY_PENDING',
  'NOTIFIED',
];
const IN_PROGRESS: readonly JobStatus[] = ['DISCOVERED', 'CLASSIFIED', 'VALIDATING', 'AI_PENDING'];

/** Why a collected job is not on the list; the enum lives in @jobsentinel/types (the API contract). */
export const REJECT_REASONS = RejectReason.options;

/** Maps a classification FILTERED_OUT reason (classification.service `decide`) to a bucket. */
export function filterReasonBucket(reason: string | null): RejectReason {
  if (!reason) return 'OTHER';
  if (/location outside india/i.test(reason)) return 'LOCATION';
  if (/category not monitored/i.test(reason)) return 'CATEGORY';
  if (/targets the \d{4} batch/i.test(reason)) return 'BATCH';
  if (/asks for|experienced role|experience unknown|not a fresher/i.test(reason))
    return 'EXPERIENCE';
  return 'OTHER';
}

export interface CollectedJob {
  status: JobStatus;
  validationStatus: ValidationStatus | null;
  closed: boolean;
  /** coalesce(posted_at, first_seen_at) */
  postedOrSeenAt: Date;
  experienceLevel: ExperienceLevel;
  experienceMinYears: number | null;
  /** Latest FILTERED_OUT reason, when the job was filtered at classification. */
  filterReason: string | null;
}

export type JobOutcome = { kept: true } | { kept: false; reason: RejectReason };

/**
 * Whether a collected job is "kept": it passed the location, fresher, validation and recency
 * gates — exactly what makes it listable (D73, D96, D102). Otherwise, the first gate it failed.
 */
export function jobOutcome(job: CollectedJob, now: Date): JobOutcome {
  if (job.status === 'FILTERED_OUT')
    return { kept: false, reason: filterReasonBucket(job.filterReason) };
  if (IN_PROGRESS.includes(job.status)) return { kept: false, reason: 'PENDING' };
  if (job.closed || job.status === 'EXPIRED' || job.validationStatus === 'EXPIRED') {
    return { kept: false, reason: 'EXPIRED' };
  }
  if (!LISTABLE.includes(job.status) || job.validationStatus !== 'VALID') {
    return { kept: false, reason: 'VALIDATION' };
  }
  if (!isFresherRole({ level: job.experienceLevel, minYears: job.experienceMinYears })) {
    return { kept: false, reason: 'EXPERIENCE' };
  }
  if (now.getTime() - job.postedOrSeenAt.getTime() > RECENCY_WINDOW_DAYS * 86_400_000) {
    return { kept: false, reason: 'STALE' };
  }
  return { kept: true };
}

export interface SourceTally {
  collected: number;
  kept: number;
  rejected: Record<RejectReason, number>;
}

export function tally(jobs: CollectedJob[], now: Date): SourceTally {
  const rejected = Object.fromEntries(REJECT_REASONS.map((r) => [r, 0])) as Record<
    RejectReason,
    number
  >;
  let kept = 0;
  for (const job of jobs) {
    const outcome = jobOutcome(job, now);
    if (outcome.kept) kept++;
    else rejected[outcome.reason]++;
  }
  return { collected: jobs.length, kept, rejected };
}

/**
 * The three cases stay separate (F2): errors are the backoff's job, collecting nothing may mean
 * a broken adapter (a human should look), and only "collected but kept none" is a poor fit.
 */
export function sourceHealth(status: SourceStatus, t: SourceTally): SourceHealth {
  if (status === 'PAUSED_AUTO') return 'PAUSED';
  if (status !== 'ACTIVE') return 'ERRORS';
  if (t.collected === 0) return 'COLLECTED_NOTHING';
  // Jobs still in the pipeline may yet be kept: not a verdict until they settle.
  if (t.kept === 0 && t.rejected.PENDING === 0) return 'KEPT_ZERO';
  return 'OK';
}

export interface AutoPauseInput {
  status: SourceStatus;
  createdAt: Date;
  resumedAt: Date | null;
  /** Tally of the jobs this source collected in the last AUTO_PAUSE_DAYS. */
  last30: SourceTally;
  now: Date;
}

export type AutoPauseDecision =
  | { pause: true; reason: string }
  | {
      pause: false;
      why: 'NOT_ACTIVE' | 'TOO_NEW' | 'COLLECTED_NOTHING' | 'KEEPS_JOBS' | 'STILL_PENDING';
    };

/**
 * Pause only an ACTIVE source, at least AUTO_PAUSE_DAYS old (or since its last resume), that
 * collected jobs in that period and kept none of them. Never deletes anything.
 */
export function decideAutoPause(input: AutoPauseInput): AutoPauseDecision {
  const { status, last30, now } = input;
  if (status !== 'ACTIVE') return { pause: false, why: 'NOT_ACTIVE' };
  const since = input.resumedAt ?? input.createdAt;
  if (now.getTime() - since.getTime() < AUTO_PAUSE_DAYS * 86_400_000) {
    return { pause: false, why: 'TOO_NEW' };
  }
  if (last30.collected === 0) return { pause: false, why: 'COLLECTED_NOTHING' };
  if (last30.kept > 0) return { pause: false, why: 'KEEPS_JOBS' };
  if (last30.rejected.PENDING > 0) return { pause: false, why: 'STILL_PENDING' };
  const top = REJECT_REASONS.filter((r) => last30.rejected[r] > 0)
    .sort((a, b) => last30.rejected[b] - last30.rejected[a])
    .slice(0, 3)
    .map((r) => `${r.toLowerCase()} ${last30.rejected[r]}`)
    .join(', ');
  return {
    pause: true,
    reason: `collected ${last30.collected} jobs in ${AUTO_PAUSE_DAYS} days and kept none (${top})`,
  };
}
