import { pgEnum } from 'drizzle-orm/pg-core';
import {
  ApplicationStatus,
  CompanyVerification,
  EmploymentType,
  ExperienceLevel,
  JobCategory,
  JobStatus,
  LogLevel,
  MatchScoring,
  NotificationChannel,
  NotificationMode,
  NotificationStatus,
  NotificationType,
  PriorityBand,
  RemotePreference,
  ResumeParseStatus,
  RoleTier,
  ScanStatus,
  ScanTrigger,
  SourcePriority,
  SourceStatus,
  SourceType,
  UrlStatus,
  ValidationStatus,
} from '@jobsentinel/types';

/**
 * Postgres enums are derived from the Zod enums in @jobsentinel/types, so the DB and the API
 * contract cannot drift (docs 02 §2). Adding a value = add it to the Zod enum + a migration.
 */
/** Zod exposes options as string[]; pgEnum needs a non-empty tuple. */
const tuple = <T extends string>(opts: readonly T[]) => opts as [T, ...T[]];

// Phase 2
export const experienceLevelEnum = pgEnum('experience_level', tuple(ExperienceLevel.options));
export const jobCategoryEnum = pgEnum('job_category', tuple(JobCategory.options));
export const employmentTypeEnum = pgEnum('employment_type', tuple(EmploymentType.options));
export const remotePreferenceEnum = pgEnum('remote_preference', tuple(RemotePreference.options));
export const resumeParseStatusEnum = pgEnum(
  'resume_parse_status',
  tuple(ResumeParseStatus.options),
);
export const roleTierEnum = pgEnum('role_tier', tuple(RoleTier.options));

// Phase 3
export const jobStatusEnum = pgEnum('job_status', tuple(JobStatus.options));
export const validationStatusEnum = pgEnum('validation_status', tuple(ValidationStatus.options));
export const urlStatusEnum = pgEnum('url_status', tuple(UrlStatus.options));
export const sourceTypeEnum = pgEnum('source_type', tuple(SourceType.options));
export const sourcePriorityEnum = pgEnum('source_priority', tuple(SourcePriority.options));
export const sourceStatusEnum = pgEnum('source_status', tuple(SourceStatus.options));
export const scanStatusEnum = pgEnum('scan_status', tuple(ScanStatus.options));
export const scanTriggerEnum = pgEnum('scan_trigger', tuple(ScanTrigger.options));
export const priorityBandEnum = pgEnum('priority_band', tuple(PriorityBand.options));
export const matchScoringEnum = pgEnum('match_scoring', tuple(MatchScoring.options));
export const applicationStatusEnum = pgEnum('application_status', tuple(ApplicationStatus.options));
export const notificationChannelEnum = pgEnum(
  'notification_channel',
  tuple(NotificationChannel.options),
);
export const notificationTypeEnum = pgEnum('notification_type', tuple(NotificationType.options));
export const notificationStatusEnum = pgEnum(
  'notification_status',
  tuple(NotificationStatus.options),
);
export const notificationModeEnum = pgEnum('notification_mode', tuple(NotificationMode.options));
export const companyVerificationEnum = pgEnum(
  'company_verification',
  tuple(CompanyVerification.options),
);
export const logLevelEnum = pgEnum('log_level', tuple(LogLevel.options));
