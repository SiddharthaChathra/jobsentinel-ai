import { z } from 'zod';

/**
 * Closed sets shared by the database (Postgres enums), the API and the frontend.
 * Keep in sync with apps/api/src/common/db/schema/enums.ts and docs/architecture/02-database.md §2.
 */

export const ExperienceLevel = z.enum(['FRESHER', 'ENTRY_LEVEL', 'EXPERIENCED', 'UNKNOWN']);
export type ExperienceLevel = z.infer<typeof ExperienceLevel>;

export const JobCategory = z.enum([
  'SOFTWARE',
  'IT_SUPPORT',
  'NETWORK',
  'CLOUD_DEVOPS',
  'DATA',
  'ELECTRICAL_ELECTRONICS',
  'MECHANICAL',
  'CIVIL',
  'OTHER_ENGINEERING',
  'NON_ENGINEERING',
  'UNKNOWN',
]);
export type JobCategory = z.infer<typeof JobCategory>;

export const EmploymentType = z.enum([
  'FULL_TIME',
  'PART_TIME',
  'INTERNSHIP',
  'CONTRACT',
  'TRAINEE',
  'UNKNOWN',
]);
export type EmploymentType = z.infer<typeof EmploymentType>;

export const JobStatus = z.enum([
  'DISCOVERED',
  'CLASSIFIED',
  'FILTERED_OUT',
  'VALIDATING',
  'VALID',
  'SUSPICIOUS',
  'NEEDS_REVIEW',
  'EXPIRED',
  'REJECTED',
  'MATCHED',
  'AI_PENDING',
  'NOTIFY_PENDING',
  'NOTIFIED',
  /** Not a job: a general application or talent pool (D117). Kept so it is not re-discovered. */
  'PLACEHOLDER',
]);
export type JobStatus = z.infer<typeof JobStatus>;

export const ValidationStatus = z.enum([
  'VALID',
  'SUSPICIOUS',
  'EXPIRED',
  'INVALID',
  'NEEDS_REVIEW',
  'PENDING',
]);
export type ValidationStatus = z.infer<typeof ValidationStatus>;

export const UrlStatus = z.enum([
  'OK',
  'REDIRECTED',
  'NOT_FOUND',
  'CLOSED',
  'BLOCKED',
  'TIMEOUT',
  'ERROR',
  'UNCHECKED',
]);
export type UrlStatus = z.infer<typeof UrlStatus>;

export const DomainRelationship = z.enum([
  'SAME_DOMAIN',
  'SUBDOMAIN',
  'KNOWN_ATS',
  'UNRELATED',
  'UNKNOWN',
]);
export type DomainRelationship = z.infer<typeof DomainRelationship>;

export const SourceType = z.enum(['ATS_API', 'PUBLIC_API', 'RSS', 'CAREER_PAGE']);
export type SourceType = z.infer<typeof SourceType>;

export const SourcePriority = z.enum(['HIGH', 'NORMAL', 'LOW']);
export type SourcePriority = z.infer<typeof SourcePriority>;

// PAUSED_AUTO: collected jobs but kept none for 30 days; not scanned until resumed (F2, D103).
export const SourceStatus = z.enum(['ACTIVE', 'DEGRADED', 'FAILING', 'DISABLED', 'PAUSED_AUTO']);
export type SourceStatus = z.infer<typeof SourceStatus>;

export const ScanStatus = z.enum(['RUNNING', 'SUCCEEDED', 'FAILED', 'TIMED_OUT']);
export type ScanStatus = z.infer<typeof ScanStatus>;

export const ScanTrigger = z.enum(['SCHEDULED', 'MANUAL', 'RECOVERY']);
export type ScanTrigger = z.infer<typeof ScanTrigger>;

export const PriorityBand = z.enum(['VERY_HIGH', 'HIGH', 'MEDIUM', 'OTHER']);
export type PriorityBand = z.infer<typeof PriorityBand>;

/**
 * How a match score was computed (F8, D112): the deterministic scorer alone, or refined by the
 * AI. RULES_ONLY rows above the AI pre-filter are retried when budget returns (`refinePending`).
 */
export const MatchScoring = z.enum(['RULES_ONLY', 'AI_REFINED']);

/** Kind of hiring (F3, D114): a college's campus drive, a fresher programme open to all, or a regular opening. */
export const PostingType = z.enum(['CAMPUS_DRIVE', 'OFF_CAMPUS_PROGRAM', 'REGULAR']);
export type PostingType = z.infer<typeof PostingType>;
export type MatchScoring = z.infer<typeof MatchScoring>;

/** How often a company posts zero-experience roles (F4, D118). UNKNOWN: fewer than 5 postings seen. */
export const FresherBand = z.enum(['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']);
export type FresherBand = z.infer<typeof FresherBand>;

export const ApplicationStatus = z.enum([
  'VIEWED',
  'APPLIED',
  'INTERVIEW',
  'SELECTED',
  'REJECTED',
  'NOT_INTERESTED',
]);
export type ApplicationStatus = z.infer<typeof ApplicationStatus>;

export const NotificationChannel = z.enum(['TELEGRAM', 'WEB']);
export type NotificationChannel = z.infer<typeof NotificationChannel>;

export const NotificationType = z.enum(['INSTANT', 'DIGEST', 'SYSTEM', 'TEST']);
export type NotificationType = z.infer<typeof NotificationType>;

export const NotificationStatus = z.enum(['PENDING', 'SENT', 'FAILED', 'SKIPPED']);
export type NotificationStatus = z.infer<typeof NotificationStatus>;

export const NotificationMode = z.enum(['INSTANT', 'DIGEST', 'BOTH', 'DISABLED']);
export type NotificationMode = z.infer<typeof NotificationMode>;

export const RemotePreference = z.enum(['ANY', 'REMOTE_ONLY', 'ONSITE_ONLY', 'HYBRID_OK']);
export type RemotePreference = z.infer<typeof RemotePreference>;

export const ResumeParseStatus = z.enum(['UPLOADED', 'PARSED', 'ANALYZED', 'FAILED']);
export type ResumeParseStatus = z.infer<typeof ResumeParseStatus>;

export const CompanyVerification = z.enum(['UNVERIFIED', 'VERIFIED', 'SUSPICIOUS', 'BLOCKED']);
export type CompanyVerification = z.infer<typeof CompanyVerification>;

export const RoleTier = z.enum(['PRIMARY', 'SECONDARY', 'OTHER']);
export type RoleTier = z.infer<typeof RoleTier>;

export const LogLevel = z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']);
export type LogLevel = z.infer<typeof LogLevel>;
