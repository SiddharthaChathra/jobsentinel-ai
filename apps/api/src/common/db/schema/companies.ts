import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { companyVerificationEnum } from './enums';
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
