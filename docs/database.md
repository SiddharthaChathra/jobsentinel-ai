# Database (live reference)

Design rationale lives in [architecture/02-database.md](architecture/02-database.md); this page is the operational reference for what is actually deployed.

**Project:** Supabase `jobsentinel-ai` (ref `hktrhvorwsymventjhfu`, ap-south-1, Postgres 17). **Schema source of truth:** `apps/api/src/common/db/schema/*.ts` (Drizzle). **Migrations:** `apps/api/src/common/db/migrations/*.sql` (drizzle-kit generated + hand-written tail sections).

## Commands

| Command             | What it does                                                                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:generate`  | Diff schema vs. the last snapshot → new SQL migration in `migrations/`. Review it; append hand-written SQL after a `--> statement-breakpoint` if needed.                           |
| `pnpm db:migrate`   | Apply pending migrations via `DATABASE_DIRECT_URL` (session pooler, port 5432). Run manually before deploying API/worker. Never runs automatically in production.                  |
| `pnpm db:seed`      | Idempotent seed: 125-skill dictionary, 32 trusted companies, 35 starter sources (34 enabled; Adzuna waits for keys). Safe to re-run; preserves user edits to `enabled`/`priority`. |
| `pnpm db:studio`    | Drizzle Studio against the direct URL (local only).                                                                                                                                |
| `scripts/backup.sh` | `pg_dump` of the `public` schema, gzip, optional `age` encryption, keeps the last 8.                                                                                               |

Connection strings: API/worker use `DATABASE_URL` (transaction pooler, port 6543, `prepare: false`); migrations/seed/backup use `DATABASE_DIRECT_URL` (port 5432). Passwords with `@` must be URL-encoded (`%40`).

## Migrations applied

| #    | File                               | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0000 | `0000_mixed_risque.sql`            | Phase 2 enums; `users`, `profiles`, `skills`, `profile_skills`, `preferred_roles`, `preferences`, `resumes`; RLS owner policies; hand-written FK `users.id → auth.users.id ON DELETE CASCADE`.                                                                                                                                                                                                                                                   |
| 0001 | `0001_nostalgic_otto_octavius.sql` | Phase 3 enums; `companies`, `job_sources`, `scan_runs`, `jobs`, `job_source_mappings`, `job_validation`, `job_matches`, `saved_jobs`, `applications`, `job_events`, `notification_settings`, `telegram_links`, `notifications`, `system_logs`, `ai_calls`, `worker_heartbeats`; indexes, checks, RLS; hand-written: `pg_trgm`, `jobs_title_trgm_idx`, `jobs_search_idx` (tsvector), `set_updated_at()` trigger on every table with `updated_at`. |

Current state (verified 2026-09-22): 23 tables, 20 policies, 19 `updated_at` triggers.

## Tables at a glance

| Table                                                        | Ownership                         | RLS                           | Natural key / idempotency                                                                                                                       |
| ------------------------------------------------------------ | --------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| users                                                        | per user (`id` = `auth.users.id`) | owner                         | —                                                                                                                                               |
| profiles, preferences, notification_settings, telegram_links | per user, 1:1                     | owner                         | `user_id` PK/unique                                                                                                                             |
| profile_skills                                               | per user via profile              | owner (via profiles)          | (`profile_id`, `skill_id`)                                                                                                                      |
| preferred_roles                                              | per user                          | owner                         | (`user_id`, `normalized_title`)                                                                                                                 |
| resumes                                                      | per user                          | owner                         | one active per user (partial unique)                                                                                                            |
| skills                                                       | shared dictionary                 | read-all                      | `normalized_name`                                                                                                                               |
| companies                                                    | shared                            | read-all                      | `normalized_name`                                                                                                                               |
| job_sources                                                  | shared                            | read-all                      | `name`; scheduler key `next_scan_at` (partial index on enabled)                                                                                 |
| scan_runs                                                    | shared                            | read-all                      | —                                                                                                                                               |
| jobs                                                         | shared canonical postings         | read-all                      | `dedupe_key` (indexed), `final_application_url`; trigram + FTS indexes                                                                          |
| job_source_mappings                                          | shared                            | read-all                      | **unique (`source_id`, `external_id`)** — ingestion upsert key                                                                                  |
| job_validation                                               | shared, 1:1 with jobs             | read-all                      | `job_id` PK                                                                                                                                     |
| job_events                                                   | shared audit trail                | read-all                      | —                                                                                                                                               |
| job_matches                                                  | per user                          | owner                         | **unique (`job_id`, `user_id`, `profile_version`)**                                                                                             |
| saved_jobs                                                   | per user                          | owner                         | (`user_id`, `job_id`) PK                                                                                                                        |
| applications                                                 | per user                          | owner                         | unique (`user_id`, `job_id`)                                                                                                                    |
| notifications                                                | per user                          | owner                         | **unique (`user_id`, `job_id`, `channel`, `type`) where job_id not null**; **unique (`user_id`, `channel`, `digest_date`) where type = DIGEST** |
| system_logs, ai_calls, worker_heartbeats                     | system                            | no policy → service role only | ai_calls cache lookup (`purpose`, `prompt_version`, `input_hash`)                                                                               |

Enums are generated from `@jobsentinel/types` Zod enums (`schema/enums.ts`), so DB and API contract cannot drift.

## Guarantees covered by tests (`apps/api/test/db.e2e-spec.ts`)

- Duplicate INSTANT notification insert is a no-op (`ON CONFLICT DO NOTHING` → 0 rows); WEB mirror still allowed.
- One digest per user/channel/day.
- `job_source_mappings` upsert is idempotent.
- `FOR UPDATE SKIP LOCKED` lease query hands disjoint sources to two overlapping transactions.
- `updated_at` trigger fires on update.
- RLS: a real user token sees only its own `users`/`notifications` rows, can read `job_sources`, cannot write them, and cannot read `system_logs`.

## Retention (worker housekeeping — Phase 4/10)

`jobs` in EXPIRED/REJECTED/FILTERED_OUT: 90 days (saved/applied never deleted). `scan_runs`, `system_logs`: 30 days. `ai_calls`: 60 days. `job_source_mappings.raw_payload`: nulled after 30 days for inactive jobs.

## Backup & restore

Weekly `scripts/backup.sh` (needs `pg_dump`; set `AGE_RECIPIENT` to encrypt). Restore into a fresh project: create the project, run `pnpm db:migrate`, then `gunzip -c <dump> | psql "$DATABASE_DIRECT_URL"`. Auth users live in Supabase's `auth` schema and are not in the dump; on restore, re-create the account(s) and re-link by id if needed. Storage objects (resumes) are not included — re-upload.

## Known caveats

- Deleting an auth user cascades all app rows but not Storage objects; the delete-my-data flow must remove `resumes/<user_id>/*` first (D35).
- `jobs.company_id` is `ON DELETE RESTRICT`; delete a company's jobs first (or block it via `is_blocked`).
- The skill dictionary grows with user-added skills (`origin = USER`); the seed only upserts its own entries.
