import { pgEnum } from 'drizzle-orm/pg-core';
import {
  ExperienceLevel,
  JobCategory,
  EmploymentType,
  RemotePreference,
  ResumeParseStatus,
  RoleTier,
} from '@jobsentinel/types';

/**
 * Postgres enums, generated from the Zod enums in @jobsentinel/types so the two can never drift
 * (a test in packages/types asserts the option lists match — see enums.spec.ts).
 * Job/validation/notification enums are added in Phase 3.
 */
/** Zod exposes options as string[]; pgEnum needs a non-empty tuple. */
const tuple = <T extends string>(opts: readonly T[]) => opts as [T, ...T[]];

export const experienceLevelEnum = pgEnum('experience_level', tuple(ExperienceLevel.options));
export const jobCategoryEnum = pgEnum('job_category', tuple(JobCategory.options));
export const employmentTypeEnum = pgEnum('employment_type', tuple(EmploymentType.options));
export const remotePreferenceEnum = pgEnum('remote_preference', tuple(RemotePreference.options));
export const resumeParseStatusEnum = pgEnum(
  'resume_parse_status',
  tuple(ResumeParseStatus.options),
);
export const roleTierEnum = pgEnum('role_tier', tuple(RoleTier.options));
