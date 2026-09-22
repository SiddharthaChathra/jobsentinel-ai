# Changelog

All notable changes, grouped by roadmap phase (docs/architecture/16-roadmap.md).

## [Phase 7] AI matching — 2026-09-22

- `@jobsentinel/validation`: `scoreMatch` — the deterministic resume ↔ job scorer (skill 0.40 / role 0.30 / experience 0.20 / location 0.10), with `canonicalSkill` alias resolution, priority banding, and an explanation built from the same evidence it scored (`Match 82% — ✓ Python ✓ SQL ✗ Kubernetes · ✓ Fresher eligible · ✓ Preferred role · ✓ Bengaluru`). Pure and synchronous; the AI never replaces it.
- `applyAiRefinement`: clamps an AI verdict to ±25 points of the deterministic skill/role scores. A model claiming 100 against a baseline of 58 yields 83, never 100; experience and location are never AI-scored.
- `@jobsentinel/ai`: `JOB_REQUIREMENTS` prompt v1 (must-have/nice-to-have skills, year range, fresher-friendliness, responsibilities — extraction only, no judgement) and `MATCH` prompt v1 (skill equivalence with the deterministic scores supplied as a baseline). Both Zod-validated with deterministic fallbacks.
- `MatchingService`: pipeline stage `VALID`/`NEEDS_REVIEW` → `MATCHED`. Per user, per `profile_version`; upserts on `(job_id, user_id, profile_version)` so re-running is free and a profile edit re-scores the backlog while keeping the old rows. The AI is only consulted for jobs already scoring ≥ 35, under `maxAiCalls` and a wall-clock budget. A `NEEDS_REVIEW` job is scored but keeps its status — ranking it is not the same as passing it.
- `--user=`/`--jobIds` scoping and `pnpm --filter @jobsentinel/api match [--batch=N] [--ai=N] [--user=<uuid>]`; worker loop gained the `match` stage after `recheck`.
- Tests: 162 validation unit tests (30 for the scorer, incl. the ±25 bound, the experience cap and "a low score never deletes a job") and 5 matching integration tests against the live DB — deterministic scoring, `(job_id, user_id, profile_version)` idempotency, re-scoring on a version bump, the AI pre-filter and bound, and the deterministic fallback when the AI is unavailable. 240 unit + 53 e2e in total.
- Live run over all 192 matchable postings (120 VALID + 72 NEEDS_REVIEW) against a representative final-year CS profile: 192 scored in 4.6 s deterministically (41 jobs/s); with AI, 8 refinements and 1 provider timeout that correctly fell back to the rules verdict. Final ranking: 1 VERY_HIGH (Thoughtworks "Developer (Vapasi) – Intern", 90), 6 MEDIUM, 185 OTHER. The temporary profile and its 576 match rows were removed afterwards and every job restored to its previous status.
- Two defects found by the live run and fixed: scores are now flushed every 50 jobs / 60 s instead of once per batch (a 10-minute AI run lost all 192 scores to a pooler timeout), and a posting the user is not eligible for is capped below the MEDIUM band (a senior role was reaching 62, and the unit test had frozen the same bug at 80).
- AI budget and response cache moved from process memory to the `ai_calls` table: the worker is a short-lived `--once` process, so the in-memory daily cap reset every tick and the cache never lived long enough to save a call. `AI_DAILY_CALL_BUDGET`/`AI_DAILY_TOKEN_BUDGET` are now counted over the UTC day and an identical input is answered from the stored response for 30 days. 5 integration tests cover recording, the cross-process cache hit, call-budget exhaustion, token-budget exhaustion and the day boundary.
- `refinePending()` + worker `refine` stage: a match whose AI refinement was skipped (budget spent or provider down) is retried when the provider recovers, highest score first. This is the `AI_PENDING` drain of docs 07 §1.4, expressed as a match row with no `ai_provider` rather than a job status, so the job stays visible in the dashboard (D53).
- `docs/matching.md` added; decisions D51–D53 recorded.

## [Phase 6] Validation engine — 2026-09-22

- `@jobsentinel/config`: validation rule data — 40-entry ATS domain allowlist, URL shorteners, free-mail providers, 9 weighted scam patterns (with sentence-level negation so "we never charge a fee" is a warning, not a demand), closed-page markers incl. ATS-specific wording, apply-form markers.
- `@jobsentinel/validation`: `domainRelationship` (SAME_DOMAIN / SUBDOMAIN / KNOWN_ATS with slug matching / UNRELATED), `lookalikeOf` (length-scaled edit distance), `detectSuspiciousIndicators`, `detectClosedMarkers`, `hasApplyForm`, and `decideValidation` — the scoring function that turns evidence into VALID / SUSPICIOUS / NEEDS_REVIEW / EXPIRED / INVALID with a confidence and a full evidence list.
- `UrlProbeService`: fetches the application page through `HttpClient` (SSRF-checked on every redirect hop), records the redirect chain, final URL and HTTP status, extracts page text, detects closure markers and apply forms. 403/429 is recorded as BLOCKED — "could not verify", never "scam".
- `CompanyVerificationService`: DNS resolution, homepage reachability, own-ATS-board evidence, multi-source presence, user trust list, look-alike domain detection; cached on the company row for 7 days.
- `ValidationOrchestrator`: pipeline stage `CLASSIFIED → VALIDATING → …`, writes `job_validation` + denormalised status, schedules the 6 h → 24 h → 72 h re-check, and `recheckDue()` which expires jobs that close after discovery (or pass 45 days).
- `SUSPICION` prompt v1, consulted only in the ambiguous 0.35–0.65 band or for an unresolved soft flag; its influence is capped at ±0.2 and it can never turn a job VALID or SUSPICIOUS on its own.
- Manual review API: `POST /jobs/:id/review` (ACCEPT/REJECT, optional note, optional "trust this company") and `POST /jobs/:id/revalidate`. `pnpm --filter @jobsentinel/api validate [--batch=N] [--ai=N] [--recheck]` CLI.
- Tests: 140 validation unit tests, 9 engine integration tests against recorded application pages (VALID / EXPIRED via three different closed-page styles / fee-scam SUSPICIOUS / unknown company NEEDS_REVIEW / blocked company REJECTED / scam-warning false-positive guard / re-check expiry), 3 review API tests. 221 unit + 48 e2e in total.
- Live run: 120 real postings validated against their actual application pages — 120 VALID, average confidence 0.94; 71 OK, 39 bot-protected, 10 redirected; 46 KNOWN_ATS, 65 SUBDOMAIN, 9 UNRELATED (slice.careers vs sliceit.com — a genuine brand-domain variant).
- Decisions D47–D50 recorded.

## [Phase 5] Fresher filtering & classification — 2026-09-22

- `@jobsentinel/config`: fresher/senior/experienced indicator sets and non-engineering role patterns, calibrated against the 2,651 real postings ingested in Phase 4.
- `@jobsentinel/validation`: `classifyExperience` (parsed year ranges outrank title tokens; internships outrank seniority words; contradictions return `UNKNOWN` + `needsAi`; every verdict carries readable evidence) and `classifyCategory` (non-engineering gate, role families, generic engineering fallback).
- `@jobsentinel/ai`: `FRESHER_CLASSIFY` prompt v1 — Zod-validated, quotes evidence from the posting, refuses to guess.
- `ClassificationService`: pipeline stage `DISCOVERED → CLASSIFIED | FILTERED_OUT`. Category/preference gate runs _before_ any AI call; a verdict below 0.6 confidence never overrides the rules; an AI outage leaves the rules result intact. Decisions are written in two statements per batch (one `UPDATE … FROM (VALUES …)`, one bulk event insert) — 1,294 jobs re-classified in 33 s (39/s) versus 0.33/s with per-job transactions.
- `requeueFiltered()` + `pnpm --filter @jobsentinel/api classify [--requeue] [--ai=N]` so a preferences change can re-apply to the whole backlog.
- Worker loop gained the `classify` stage; `AI_REQUEST_TIMEOUT_MS` (default 20 s) and a per-batch AI time budget keep a slow provider from stalling a tick.
- Accuracy gate (`classification-accuracy.spec.ts`): 72 hand-labelled postings — 60 sampled from real boards plus 12 authored fresher-path cases. Current agreement **100 % on experience level and 100 % on engineering/non-engineering**, with explicit assertions that no clearly senior posting is ever called fresher-eligible and that abstention stays under 25 %.
- Live run over all 2,651 ingested jobs: 1,229 CLASSIFIED / 1,422 FILTERED_OUT; levels 2,327 EXPERIENCED, 226 UNKNOWN, 59 FRESHER, 39 ENTRY_LEVEL; categories 1,100 NON_ENGINEERING, 520 OTHER_ENGINEERING, 391 SOFTWARE, 134 NETWORK, 68 CLOUD_DEVOPS, 60 DATA, 52 IT_SUPPORT.
- Tests: 184 unit (106 validation, 54 api, 24 packages) and 36 e2e; the e2e suites now run serially because they share one live Supabase project.
- Decisions D42–D46 recorded.

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
