import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { companyVerificationEnum, fresherBandEnum } from './enums';
import { readAllPolicy, timestamps } from './shared';

// ── companies (docs 02 §3.4) ──────────────────────────────────────────────────
export const companies = pgTable(
  'companies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull().unique(),
    websiteDomain: text('website_domain'),
    careersUrl: text('careers_url'),
    atsProvider: text('ats_provider'),
    atsSlug: text('ats_slug'),
    verificationStatus: companyVerificationEnum('verification_status')
      .notNull()
      .default('UNVERIFIED'),
    verificationConfidence: numeric('verification_confidence', { precision: 3, scale: 2 }),
    verificationEvidence: jsonb('verification_evidence').notNull().default([]),
    isTrusted: boolean('is_trusted').notNull().default(false),
    isBlocked: boolean('is_blocked').notNull().default(false),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    sourcesCount: integer('sources_count').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index('companies_domain_idx').on(t.websiteDomain),
    check(
      'companies_confidence_range',
      sql`${t.verificationConfidence} is null or (${t.verificationConfidence} between 0 and 1)`,
    ),
    readAllPolicy('companies'),
  ],
).enableRLS();

// ── company_fresher_stats (F4, D118) ─────────────────────────────────────────
// Recomputed by the worker from `jobs`; never read by classification, validation, matching or
// notifications. It only spaces a company board's scans and drives the "Hires freshers often" badge.
export const companyFresherStats = pgTable(
  'company_fresher_stats',
  {
    companyId: uuid('company_id')
      .primaryKey()
      .references(() => companies.id, { onDelete: 'cascade' }),
    postingsSeen: integer('postings_seen').notNull().default(0),
    fresherCount: integer('fresher_count').notNull().default(0),
    lastFresherAt: timestamp('last_fresher_at', { withTimezone: true }),
    weightedAll: doublePrecision('weighted_all').notNull().default(0),
    weightedFresher: doublePrecision('weighted_fresher').notNull().default(0),
    score: smallint('score'),
    band: fresherBandEnum('band').notNull().default('UNKNOWN'),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    check(
      'company_fresher_stats_score_range',
      sql`${t.score} is null or (${t.score} between 0 and 100)`,
    ),
    readAllPolicy('company_fresher_stats'),
  ],
).enableRLS();
