import { z } from 'zod';
import type { CompanyVerification, EmploymentType } from '../enums';
import {
  ApplicationStatus,
  ExperienceLevel,
  JobCategory,
  PriorityBand,
  ValidationStatus,
} from '../enums';

/**
 * Jobs list query — docs/architecture/03-api-contract.md §3.
 * Array filters accept either `?category=SOFTWARE&category=DATA` or `?category=SOFTWARE,DATA`,
 * because a browser query string has no single convention and both reach us in practice.
 */
const csv = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v: unknown) => {
    if (v === undefined || v === null) return undefined;
    const raw: unknown[] = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [v];
    const cleaned = raw
      .filter((p): p is string => typeof p === 'string')
      .map((p) => p.trim())
      .filter(Boolean);
    return cleaned.length > 0 ? cleaned : undefined;
  }, z.array(item).max(30).optional());

const bool = z.preprocess((v) => {
  if (v === undefined || v === '') return undefined;
  if (typeof v === 'boolean') return v;
  return v === 'true' || v === '1';
}, z.boolean().optional());

const int = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : Number(v)),
    z.number().int().min(min).max(max).optional(),
  );

export const JobSort = z.enum(['newest', 'score', 'posted']);
export type JobSort = z.infer<typeof JobSort>;

export const JobActivity = z.enum(['ACTIVE', 'EXPIRED', 'ALL']);
export type JobActivity = z.infer<typeof JobActivity>;

export const JobsQuery = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  roleFamily: csv(z.string().max(60)),
  category: csv(JobCategory),
  companyId: z.uuid().optional(),
  location: z.string().trim().min(1).max(80).optional(),
  /** By default the list is limited to the user's preferred locations; true lifts that. */
  anywhere: bool,
  remote: bool,
  fresherOnly: bool,
  experienceLevel: csv(ExperienceLevel),
  minScore: int(0, 100),
  priority: csv(PriorityBand),
  validationStatus: csv(ValidationStatus),
  status: JobActivity.optional(),
  postedAfter: z.iso.datetime().optional(),
  sourceId: z.uuid().optional(),
  salaryMin: int(0, 100_000_000),
  saved: bool,
  tracker: csv(ApplicationStatus),
  sort: JobSort.optional(),
  cursor: z.string().max(200).optional(),
  limit: int(1, 100),
});
export type JobsQuery = z.infer<typeof JobsQuery>;

export interface JobCompanyRef {
  id: string;
  name: string;
  domain: string | null;
  verificationStatus: CompanyVerification;
}

export interface JobLocation {
  text: string | null;
  city: string | null;
  country: string | null;
  isRemote: boolean;
}

export interface JobSalary {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: string | null;
  text: string | null;
  disclosed: boolean;
}

export interface JobValidationSummary {
  status: ValidationStatus;
  confidence: number | null;
  companyVerified: boolean;
  applicationVerified: boolean;
  jobActive: boolean;
}

export interface JobMatchSummary {
  overallScore: number;
  priority: PriorityBand;
  matchedSkills: string[];
}

export interface TrackerState {
  saved: boolean;
  status: ApplicationStatus | null;
}

export interface JobCard {
  id: string;
  title: string;
  company: JobCompanyRef;
  location: JobLocation;
  employmentType: EmploymentType;
  experienceLevel: ExperienceLevel;
  fresherEligible: boolean | null;
  experienceText: string | null;
  salary: JobSalary | null;
  postedAt: string | null;
  firstSeenAt: string;
  deadline: string | null;
  validation: JobValidationSummary;
  match: JobMatchSummary | null;
  tracker: TrackerState;
  applicationUrl: string;
  /** First seen in the last 24 h and not yet opened by the user. */
  isNew: boolean;
}

// ── Needs review (C step 2, D106) ─────────────────────────────────────────────

/**
 * Why a job is held out of the main list. CATEGORY_UNKNOWN: the AI could not place its category
 * (D105). COMPANY_UNVERIFIED: the employer could not be confirmed — usually a job board that links
 * only to its own page. URL_UNREACHABLE: the application page could not be reached. OTHER: any
 * other reason from verification.
 */
export const HeldKind = z.enum([
  'CATEGORY_UNKNOWN',
  /** The posting states no experience and the AI could not place it (D110). */
  'EXPERIENCE_UNKNOWN',
  'COMPANY_UNVERIFIED',
  'URL_UNREACHABLE',
  'OTHER',
]);
export type HeldKind = z.infer<typeof HeldKind>;

export interface HeldInfo {
  kind: HeldKind;
  /** Plain-language explanation for the user, e.g. "Company not verified: …". */
  label: string;
  /** The pipeline's own reason, for the detail view. */
  reason: string;
}

/** A job in the Needs review view: never in the main list, never sent to Telegram (D106). */
export interface ReviewJobCard extends JobCard {
  held: HeldInfo;
}

export interface JobEventItem {
  id: string;
  type: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface JobSourceRef {
  name: string;
  url: string;
  firstSeenAt: string;
}

export interface JobMatchDetail extends JobMatchSummary {
  skillScore: number;
  roleScore: number;
  experienceScore: number;
  locationScore: number;
  missingSkills: string[];
  explanation: string | null;
  aiProvider: string | null;
  /** No AI verdict yet: the budget was spent or the provider was unavailable. */
  aiPending: boolean;
}

export interface JobValidationDetail extends JobValidationSummary {
  urlStatus: string | null;
  httpStatus: number | null;
  finalUrl: string | null;
  evidence: { code: string; weight: number; detail?: string }[];
  suspiciousFlags: string[];
  aiAssessment: Record<string, unknown> | null;
  checkedAt: string | null;
  nextCheckAt: string | null;
}

export interface JobDetail extends Omit<JobCard, 'match'> {
  description: string;
  requirements: string[];
  skills: string[];
  sourceUrl: string;
  sources: JobSourceRef[];
  validationDetail: JobValidationDetail;
  match: JobMatchDetail | null;
  events: JobEventItem[];
}

export const NotInterestedInput = z.object({ reason: z.string().trim().max(200).optional() });
export type NotInterestedInput = z.infer<typeof NotInterestedInput>;

export const ApplicationUpsert = z.object({
  status: ApplicationStatus,
  notes: z.string().trim().max(2000).optional(),
  appliedAt: z.iso.datetime().optional(),
});
export type ApplicationUpsert = z.infer<typeof ApplicationUpsert>;

export const ApplicationsQuery = z.object({
  status: csv(ApplicationStatus),
  cursor: z.string().max(200).optional(),
  limit: int(1, 100),
});
export type ApplicationsQuery = z.infer<typeof ApplicationsQuery>;

export interface ApplicationHistoryEntry {
  status: ApplicationStatus;
  at: string;
  note?: string;
}

export interface ApplicationItem {
  job: JobCard;
  status: ApplicationStatus;
  appliedAt: string | null;
  notes: string | null;
  history: ApplicationHistoryEntry[];
  updatedAt: string;
}

export const SavedJobsQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: int(1, 100),
});
export type SavedJobsQuery = z.infer<typeof SavedJobsQuery>;

export interface DashboardSummary {
  newToday: number;
  newThisWeek: number;
  byPriority: { veryHigh: number; high: number; medium: number; other: number };
  needsReview: number;
  saved: number;
  applications: { applied: number; interview: number; selected: number };
  recentJobs: JobCard[];
  topMatches: JobCard[];
  system: {
    workerAlive: boolean;
    lastScanAt: string | null;
    failingSources: number;
  };
}
