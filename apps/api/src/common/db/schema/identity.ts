import { sql } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';
import {
  employmentTypeEnum,
  experienceLevelEnum,
  jobCategoryEnum,
  remotePreferenceEnum,
  resumeParseStatusEnum,
  roleTierEnum,
} from './enums';

import { ownerPolicy, timestamps } from './shared';

// ── users ──────────────────────────────────────────────────────────────────────
export const users = pgTable(
  'users',
  {
    // FK to auth.users(id) ON DELETE CASCADE is added by hand in migration 0000 (Supabase-managed schema).
    id: uuid('id').primaryKey(),
    email: text('email').notNull().unique(),
    displayName: text('display_name'),
    isAdmin: boolean('is_admin').notNull().default(false),
    onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
    profileVersion: integer('profile_version').notNull().default(0),
    ...timestamps,
  },
  () => [ownerPolicy('users', 'id')],
).enableRLS();

// ── profiles ───────────────────────────────────────────────────────────────────
export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceResumeId: uuid('source_resume_id'),
    experienceLevel: experienceLevelEnum('experience_level').notNull().default('FRESHER'),
    graduationYear: smallint('graduation_year'),
    degree: text('degree'),
    branch: text('branch'),
    college: text('college'),
    locationText: text('location_text'),
    summary: text('summary'),
    education: jsonb('education').notNull().default([]),
    projects: jsonb('projects').notNull().default([]),
    experience: jsonb('experience').notNull().default([]),
    certifications: jsonb('certifications').notNull().default([]),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    ...timestamps,
  },
  () => [ownerPolicy('profiles')],
).enableRLS();

// ── skills (global dictionary) ─────────────────────────────────────────────────
export const skills = pgTable(
  'skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull().unique(),
    category: text('category').notNull(),
    aliases: text('aliases').array().notNull().default([]),
    ...timestamps,
  },
  () => [pgPolicy('skills_read', { for: 'select', to: authenticatedRole, using: sql`true` })],
).enableRLS();

export const profileSkills = pgTable(
  'profile_skills',
  {
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    proficiency: text('proficiency'),
    origin: text('origin').notNull().default('RESUME'),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.profileId, t.skillId] }),
    pgPolicy('profile_skills_owner', {
      for: 'all',
      to: authenticatedRole,
      using: sql`profile_id in (select id from profiles where user_id = (select auth.uid()))`,
      withCheck: sql`profile_id in (select id from profiles where user_id = (select auth.uid()))`,
    }),
  ],
).enableRLS();

// ── preferred roles ────────────────────────────────────────────────────────────
export const preferredRoles = pgTable(
  'preferred_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    normalizedTitle: text('normalized_title').notNull(),
    roleFamily: text('role_family').notNull().default('unknown'),
    tier: roleTierEnum('tier').notNull().default('PRIMARY'),
    enabled: boolean('enabled').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('preferred_roles_user_title_idx').on(t.userId, t.normalizedTitle),
    ownerPolicy('preferred_roles'),
  ],
).enableRLS();

// ── preferences ────────────────────────────────────────────────────────────────
export const preferences = pgTable(
  'preferences',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    locations: text('locations').array().notNull().default(['India']),
    remotePreference: remotePreferenceEnum('remote_preference').notNull().default('ANY'),
    // New users see full-time and trainee (graduate trainee) roles by default (owner, 2026-10-18).
    employmentTypes: employmentTypeEnum('employment_types')
      .array()
      .notNull()
      .default(['FULL_TIME', 'TRAINEE']),
    categories: jobCategoryEnum('categories')
      .array()
      .notNull()
      .default(['SOFTWARE', 'IT_SUPPORT', 'NETWORK', 'CLOUD_DEVOPS', 'DATA']),
    fresherOnly: boolean('fresher_only').notNull().default(true),
    includeUnknownExperience: boolean('include_unknown_experience').notNull().default(true),
    salaryMin: integer('salary_min'),
    salaryCurrency: text('salary_currency').notNull().default('INR'),
    graduationYear: smallint('graduation_year'),
    timezone: text('timezone').notNull().default('Asia/Kolkata'),
    instantMinScore: smallint('instant_min_score').notNull().default(75),
    ...timestamps,
  },
  () => [ownerPolicy('preferences')],
).enableRLS();

// ── resumes ────────────────────────────────────────────────────────────────────
export const resumes = pgTable(
  'resumes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    storagePath: text('storage_path').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    parseStatus: resumeParseStatusEnum('parse_status').notNull().default('UPLOADED'),
    extractedText: text('extracted_text'),
    aiAnalysis: jsonb('ai_analysis'),
    aiProvider: text('ai_provider'),
    aiModel: text('ai_model'),
    promptVersion: text('prompt_version'),
    isActive: boolean('is_active').notNull().default(false),
    errorMessage: text('error_message'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    parsedAt: timestamp('parsed_at', { withTimezone: true }),
    analyzedAt: timestamp('analyzed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('resumes_one_active_idx')
      .on(t.userId)
      .where(sql`is_active = true`),
    ownerPolicy('resumes'),
  ],
).enableRLS();
