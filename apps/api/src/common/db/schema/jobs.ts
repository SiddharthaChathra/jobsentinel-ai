import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  applicationStatusEnum,
  employmentTypeEnum,
  experienceLevelEnum,
  jobCategoryEnum,
  jobStatusEnum,
  matchScoringEnum,
  postingTypeEnum,
  priorityBandEnum,
  urlStatusEnum,
  validationStatusEnum,
} from './enums';
import { companies } from './companies';
import { users } from './identity';
import { ownerPolicy, readAllPolicy, timestamps } from './shared';
import { jobSources } from './sources';

// ── jobs (canonical posting) ──────────────────────────────────────────────────
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    normalizedTitle: text('normalized_title').notNull(),
    roleFamily: text('role_family').notNull().default('unknown'),
    category: jobCategoryEnum('category').notNull().default('UNKNOWN'),
    description: text('description').notNull().default(''),
    descriptionHtml: text('description_html'),
    requirements: text('requirements').array().notNull().default([]),
    skills: text('skills').array().notNull().default([]),
    locationText: text('location_text'),
    locationCity: text('location_city'),
    locationCountry: text('location_country'),
    isRemote: boolean('is_remote').notNull().default(false),
    employmentType: employmentTypeEnum('employment_type').notNull().default('UNKNOWN'),
    experienceText: text('experience_text'),
    experienceMinYears: numeric('experience_min_years', { precision: 3, scale: 1 }),
    experienceMaxYears: numeric('experience_max_years', { precision: 3, scale: 1 }),
    experienceLevel: experienceLevelEnum('experience_level').notNull().default('UNKNOWN'),
    fresherEligible: boolean('fresher_eligible'),
    fresherConfidence: numeric('fresher_confidence', { precision: 3, scale: 2 }),
    fresherEvidence: jsonb('fresher_evidence').notNull().default([]),
    salaryMin: numeric('salary_min', { precision: 14, scale: 2 }),
    salaryMax: numeric('salary_max', { precision: 14, scale: 2 }),
    salaryCurrency: text('salary_currency'),
    salaryPeriod: text('salary_period'),
    salaryText: text('salary_text'),
    salaryDisclosed: boolean('salary_disclosed').notNull().default(false),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    deadline: timestamp('deadline', { withTimezone: true }),
    sourceUrl: text('source_url').notNull(),
    applicationUrl: text('application_url'),
    finalApplicationUrl: text('final_application_url'),
    dedupeKey: text('dedupe_key').notNull(),
    descriptionSimhash: bigint('description_simhash', { mode: 'bigint' }),
    contentHash: text('content_hash'),
    validationStatus: validationStatusEnum('validation_status').notNull().default('PENDING'),
    validationConfidence: numeric('validation_confidence', { precision: 3, scale: 2 }),
    status: jobStatusEnum('status').notNull().default('DISCOVERED'),
    stageError: text('stage_error'),
    stageAttempts: integer('stage_attempts').notNull().default(0),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    matchedAt: timestamp('matched_at', { withTimezone: true }),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    // When the AI was asked for this job's category: once per canonical job, never again (D105).
    categoryAiAt: timestamp('category_ai_at', { withTimezone: true }),
    // Why classification held this job for review (category or experience unknown, D105/D110).
    // A held job still goes through validation; a VALID verdict then leaves it NEEDS_REVIEW.
    holdReason: text('hold_reason'),
    // Campus drive, off-campus fresher programme or regular opening, set at classification (D114).
    postingType: postingTypeEnum('posting_type').notNull().default('REGULAR'),
    nextCheckAt: timestamp('next_check_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('jobs_status_idx').on(t.status),
    index('jobs_first_seen_idx').on(t.firstSeenAt.desc()),
    index('jobs_posted_idx').on(t.postedAt.desc().nullsLast()),
    index('jobs_company_idx').on(t.companyId),
    index('jobs_category_fresher_idx')
      .on(t.category, t.fresherEligible)
      .where(sql`status in ('VALID','MATCHED','NOTIFIED','NEEDS_REVIEW')`),
    index('jobs_dedupe_key_idx').on(t.dedupeKey),
    index('jobs_app_url_idx').on(t.finalApplicationUrl),
    index('jobs_next_check_idx')
      .on(t.nextCheckAt)
      .where(sql`status in ('VALID','MATCHED','NOTIFIED')`),
    index('jobs_location_idx').on(t.locationCountry, t.locationCity),
    // pg_trgm title index and the full-text index are hand-written in the migration (extension + expression index).
    readAllPolicy('jobs'),
  ],
).enableRLS();

// ── job_source_mappings ───────────────────────────────────────────────────────
export const jobSourceMappings = pgTable(
  'job_source_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => jobSources.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    sourceUrl: text('source_url').notNull(),
    rawPayload: jsonb('raw_payload'),
    isPrimary: boolean('is_primary').notNull().default(false),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('job_source_mappings_source_external_idx').on(t.sourceId, t.externalId),
    index('job_source_mappings_job_idx').on(t.jobId),
    readAllPolicy('job_source_mappings'),
  ],
).enableRLS();

// ── job_validation (1:1) ──────────────────────────────────────────────────────
export const jobValidation = pgTable(
  'job_validation',
  {
    jobId: uuid('job_id')
      .primaryKey()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    status: validationStatusEnum('status').notNull().default('PENDING'),
    confidence: numeric('confidence', { precision: 3, scale: 2 }),
    companyVerified: boolean('company_verified').notNull().default(false),
    applicationVerified: boolean('application_verified').notNull().default(false),
    jobActive: boolean('job_active').notNull().default(true),
    fresherEligible: boolean('fresher_eligible'),
    originalUrl: text('original_url'),
    finalUrl: text('final_url'),
    httpStatus: smallint('http_status'),
    redirectChain: jsonb('redirect_chain').notNull().default([]),
    urlStatus: urlStatusEnum('url_status').notNull().default('UNCHECKED'),
    urlDomainRelationship: text('url_domain_relationship'),
    suspiciousFlags: text('suspicious_flags').array().notNull().default([]),
    evidence: jsonb('evidence').notNull().default([]),
    aiAssessment: jsonb('ai_assessment'),
    reviewNote: text('review_note'),
    reviewedByUserAt: timestamp('reviewed_by_user_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    nextCheckAt: timestamp('next_check_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check(
      'job_validation_confidence_range',
      sql`${t.confidence} is null or (${t.confidence} between 0 and 1)`,
    ),
    readAllPolicy('job_validation'),
  ],
).enableRLS();

// ── job_matches (per user) ────────────────────────────────────────────────────
export const jobMatches = pgTable(
  'job_matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    profileVersion: integer('profile_version').notNull(),
    overallScore: smallint('overall_score').notNull(),
    skillScore: smallint('skill_score').notNull(),
    roleScore: smallint('role_score').notNull(),
    experienceScore: smallint('experience_score').notNull(),
    locationScore: smallint('location_score').notNull(),
    priority: priorityBandEnum('priority').notNull(),
    matchedSkills: text('matched_skills').array().notNull().default([]),
    missingSkills: text('missing_skills').array().notNull().default([]),
    explanation: text('explanation'),
    aiProvider: text('ai_provider'),
    aiModel: text('ai_model'),
    promptVersion: text('prompt_version'),
    // Explicit, not inferred from ai_provider, so the UI and digest can say "rules only" (D112).
    scoring: matchScoringEnum('scoring').notNull().default('RULES_ONLY'),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('job_matches_job_user_version_idx').on(t.jobId, t.userId, t.profileVersion),
    index('job_matches_user_score_idx').on(t.userId, t.overallScore.desc()),
    index('job_matches_job_idx').on(t.jobId),
    check('job_matches_score_range', sql`${t.overallScore} between 0 and 100`),
    ownerPolicy('job_matches'),
  ],
).enableRLS();

// ── user interaction ──────────────────────────────────────────────────────────
export const savedJobs = pgTable(
  'saved_jobs',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'restrict' }),
    note: text('note'),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.userId, t.jobId] }), ownerPolicy('saved_jobs')],
).enableRLS();

export const applications = pgTable(
  'applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'restrict' }),
    status: applicationStatusEnum('status').notNull().default('VIEWED'),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    notes: text('notes'),
    history: jsonb('history').notNull().default([]),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('applications_user_job_idx').on(t.userId, t.jobId),
    index('applications_user_status_idx').on(t.userId, t.status),
    ownerPolicy('applications'),
  ],
).enableRLS();

// ── job_events (audit trail) ──────────────────────────────────────────────────
export const jobEvents = pgTable(
  'job_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    detail: jsonb('detail').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('job_events_job_idx').on(t.jobId, t.createdAt.desc()), readAllPolicy('job_events')],
).enableRLS();
