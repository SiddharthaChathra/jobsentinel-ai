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

/** Defaults; the deployed values come from AUTO_PAUSE_MIN_COLLECTED / AUTO_PAUSE_WINDOW_DAYS. */
export const AUTO_PAUSE_DEFAULTS = { minCollected: 20, windowDays: AUTO_PAUSE_DAYS } as const;

/**
 * A source India-scoped by design is never auto-paused — reported and alerted instead (D104).
 * Adzuna searches with country `in` (its default), or any source whose config says so.
 */
export function isIndiaScopedSource(source: { adapter: string; config: unknown }): boolean {
  const config = (source.config ?? {}) as { country?: unknown; indiaScoped?: unknown };
  if (config.indiaScoped === true) return true;
  if (source.adapter !== 'adzuna') return false;
  const country = typeof config.country === 'string' ? config.country : 'in';
  return country.toLowerCase() === 'in';
}

export interface AutoPauseInput {
  status: SourceStatus;
  createdAt: Date;
  resumedAt: Date | null;
  /** Tally of the jobs this source collected in the last `windowDays`. */
  window: SourceTally;
  now: Date;
  /** Fewer collected jobs than this is too small a sample to judge (D104). */
  minCollected: number;
  windowDays: number;
  /** India-scoped by design: alert instead of pausing (D104). */
  exempt: boolean;
}

export type AutoPauseDecision =
  | { action: 'PAUSE'; reason: string }
  /** Would be paused, but is exempt: report it and alert the owner instead. */
  | { action: 'ALERT'; reason: string }
  | {
      action: 'NONE';
      why: 'NOT_ACTIVE' | 'TOO_NEW' | 'TOO_FEW' | 'KEEPS_JOBS' | 'STILL_PENDING';
    };

/**
 * Pause only an ACTIVE source, at least `windowDays` old (or since its last resume), that
 * collected at least `minCollected` jobs in that window and kept none of them. An exempt
 * (India-scoped) source gets an ALERT instead. Never deletes anything.
 */
export function decideAutoPause(input: AutoPauseInput): AutoPauseDecision {
  const { status, window: w, now, minCollected, windowDays } = input;
  if (status !== 'ACTIVE') return { action: 'NONE', why: 'NOT_ACTIVE' };
  const since = input.resumedAt ?? input.createdAt;
  if (now.getTime() - since.getTime() < windowDays * 86_400_000) {
    return { action: 'NONE', why: 'TOO_NEW' };
  }
  // Covers "collected nothing" too: that case is a possibly broken source, never a pause (F2).
  if (w.collected < minCollected) return { action: 'NONE', why: 'TOO_FEW' };
  if (w.kept > 0) return { action: 'NONE', why: 'KEEPS_JOBS' };
  if (w.rejected.PENDING > 0) return { action: 'NONE', why: 'STILL_PENDING' };
  const top = REJECT_REASONS.filter((r) => w.rejected[r] > 0)
    .sort((a, b) => w.rejected[b] - w.rejected[a])
    .slice(0, 3)
    .map((r) => `${r.toLowerCase()} ${w.rejected[r]}`)
    .join(', ');
  const reason = `collected ${w.collected} jobs in ${windowDays} days and kept none (${top})`;
  return input.exempt ? { action: 'ALERT', reason } : { action: 'PAUSE', reason };
}
