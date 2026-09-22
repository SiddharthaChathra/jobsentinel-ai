# Changelog

All notable changes, grouped by roadmap phase (docs/architecture/16-roadmap.md).

## [Phase 4] Job ingestion — 2026-09-22

- `HttpClient`: single outbound gateway — DNS-first SSRF guard on every redirect hop (with NAT64 decoding), timeouts, retries with jitter on 5xx/network only, `Retry-After`, per-host politeness, 20 MB body cap, identifying User-Agent. 25 tests.
- `JobSource` contract + `SourceRegistry`; adapters **greenhouse, lever, ashby, remotive, rss** with recorded real fixtures (10 tests) and live verification. Blocked (403/429) sources back off and self-disable after 3 strikes.
- `@jobsentinel/validation`: `normalizeCompanyName`, `normalizeLocation` (Indian metros + global hubs), `parseEmploymentType`, `parseExperience`, `parseSalary` (LPA/lakhs/USD, never invents), `cleanUrl`, `htmlToText`, dedupe primitives (`dedupeTitleKey` keeps level markers, `computeDedupeKey`, 64-bit SimHash, `titleSimilarity`). 68 tests.
- `normalizeRawJob` (sanitized HTML → text, requirements, skills, keys) and `DedupeService.upsertBatch`: batched, transactional merge order mapping → URL → dedupe key → SimHash+title → within-batch; only primary mappings update canonical content.
- `SourceManager.runScan` (one scan = one `scan_runs` row, per-record isolation, cursor advances only on success, backoff table), `SchedulerService` (SKIP LOCKED leases, manual-first ordering, `--sources=` override), `RecoveryService.sweep`, `HousekeepingService` (heartbeats, daily retention), upgraded `WorkerLoop`.
- Admin API `/sources*` (list, adapters, create with validation, patch, manual scan, validate, scan history) and `/system/status`.
- Live results: all 33 seeded sources ACTIVE; 2,600+ real postings ingested; rescans idempotent; kill-mid-scan recovered with 0 duplicate mappings / 0 duplicate dedupe keys. Throughput ~7 jobs/s after storing text only and stripping raw payloads.
- Tests: 143 unit, 24 e2e (ingestion pipeline with a scripted adapter against the live DB, sources API, DB guarantees, onboarding).
- Seed fixes: Lever `porter` and Ashby `navi` removed (wrong companies behind the slugs); seed now shares `normalizeCompanyName` with the pipeline.
- Decisions D36–D40 recorded.

## [Phase 3] Database — 2026-09-22

- Migration 0001: 16 new tables (`companies`, `job_sources`, `scan_runs`, `jobs`, `job_source_mappings`, `job_validation`, `job_matches`, `saved_jobs`, `applications`, `job_events`, `notification_settings`, `telegram_links`, `notifications`, `system_logs`, `ai_calls`, `worker_heartbeats`), 17 Postgres enums derived from the Zod enums, indexes/checks/RLS, plus hand-written `pg_trgm`, trigram + full-text indexes on jobs and a `set_updated_at()` trigger on every table with `updated_at`. Live project: 23 tables, 20 policies.
- Schema split into `identity`, `companies`, `sources`, `jobs`, `notifications`, `system` files with shared `ownerPolicy`/`readAllPolicy` helpers.
- Seed (`pnpm db:seed`, idempotent): 125-skill dictionary, 32 trusted companies, 35 starter sources — 31 ATS boards (Greenhouse/Lever/Ashby, each verified live), Remotive, WeWorkRemotely RSS, Adzuna (disabled until keys); staggered `next_scan_at`.
- `scripts/backup.sh` (pg_dump + gzip + optional age), `docs/database.md` operational reference.
- Tests: 6 DB integration tests against the live project (unique notification, one digest/day, idempotent mappings, `SKIP LOCKED` leasing with overlapping transactions, `updated_at` trigger, RLS isolation with a real user token). All 17 e2e pass.
- User account for the owner created in Supabase Auth.

## [Phase 2] Auth + profile + resume — 2026-09-22

- Supabase project `jobsentinel-ai` (ap-south-1) created; migration 0000 applied: `users`, `profiles`, `skills`, `profile_skills`, `preferred_roles`, `preferences`, `resumes` with RLS owner policies and an FK to `auth.users` (Drizzle schema + drizzle-kit migrations).
- Auth: `SupabaseJwtGuard` verifying ES256 tokens offline via the project JWKS (`jose`), first-login user bootstrap with the `ALLOWED_SIGNUP_EMAILS` gate, `AdminGuard`, `@CurrentUser()`, `@Public()`.
- Common: Drizzle `DbModule` (transaction pooler, `prepare: false`), `AppError` + `HttpExceptionFilter` (error envelope), `EnvelopeInterceptor`, `ZodValidationPipe`, request-id middleware, throttling, DB readiness check.
- Users API: `/me`, `/profile` (PUT upserts skills into the dictionary, bumps `profile_version`, completes onboarding), `/preferences`, `/preferred-roles` (role-family classification), `/skills/search`.
- Resumes API: multipart upload with magic-byte checks → private Supabase Storage bucket (auto-created) → PDF (`unpdf`) / DOCX (`mammoth`) text extraction → AI analysis with PII redaction → draft → activate / download (signed URL) / delete; deterministic fallback (skill dictionary + graduation-year regex) when AI is unavailable.
- `@jobsentinel/ai`: `AIService` (cache → budget → provider chain → JSON repair → Zod → repair retry), fetch-based `GeminiAdapter` (JSON mode, schema sanitizer) and `ClaudeAdapter` (forced tool use), `RESUME_PROFILE` prompt v1, provider factory from env.
- `@jobsentinel/config`: role-family taxonomy, 120-entry skill dictionary. `@jobsentinel/validation`: `classifyRoleFamily`, `extractSkills`, `extractGraduationYear`.
- Web: React Query provider, `useApi` / `serverApi` clients, onboarding gate in the app layout, three-step onboarding (upload → review draft → preferences), dashboard shows the confirmed profile.
- Tests: 60 unit (packages + api + web) and 11 e2e against the live Supabase project (real auth user + JWKS, storage, PDF parsing); live-AI variant behind `AI_LIVE_TESTS=1`. Browser walkthrough verified with Playwright.
- Decisions D30–D35 recorded (jose 5, e2e VM-modules flag, Gemini schema subset, no thinking config on Lite models, REST adapters, storage cleanup on user deletion).

## [Phase 1] Project setup — 2026-09-22

- pnpm workspace monorepo: `apps/web`, `apps/api`, `packages/{types,validation,ai,config}`.
- `packages/config`: Zod-validated environment schema (`loadEnv`, `assertEnv`) with tests.
- `packages/types`: domain enums + API envelope schemas. `packages/validation`: `normalizeTitle`. `packages/ai`: `AIProvider` interface + JSON repair.
- `apps/api`: NestJS 11 with two entrypoints (`main.ts` HTTP API, `worker.ts` worker loop with `--once`), `/health` + `/health/ready`, pino logging with redaction, Jest unit + Supertest e2e.
- `apps/web`: Next.js 16 + Tailwind v4 + shadcn/ui, Supabase auth clients, `proxy.ts` auth gate, login (password + magic link), placeholder dashboard, typed API client with Vitest tests.
- Tooling: ESLint (type-checked), Prettier, CI workflow (gitleaks + lint/typecheck/test/build), pre-commit secret scan, `.env.example`, `AGENTS.md`, `README.md`.
- Decisions recorded: NestJS pinned to 11 (v12 is ESM-only), TypeScript 5.9 (v7 native compiler not yet supported by tooling), Next.js 16 uses `proxy.ts` instead of `middleware.ts`.

## [Phase 0] Architecture — 2026-09-22

- Architecture package under `docs/architecture/` (22 items: decisions, system, database, API, frontend, backend, sources, scheduler/recovery, validation, AI, notifications, security, folders/env, testing, deployment/free-first, responsibility split, roadmap, risks/MVP).
