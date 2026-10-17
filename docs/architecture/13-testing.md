# 13 — Testing Strategy

## 1. Pyramid

| Layer                        | Tooling                                                               | Scope                                                                                                                                                                                                             | Runs                     |
| ---------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Unit (pure)                  | Jest (`packages/*`, `apps/api`)                                       | normalization, fresher rules, suspicion patterns, domain relationship, dedupe keys/SimHash, salary/location extraction, scorer, priority bands, JSON repair, env schema                                           | every commit, < 30 s     |
| Unit (services)              | Jest + fakes                                                          | `SourceManager`, `DedupeService`, `ValidationOrchestrator`, `MatchingService`, `NotificationDispatcher`, `SchedulerService` with `FakeHttpClient`, `FakeAIProvider`, `FakeTelegram`, `FakeClock`, in-memory repos | every commit             |
| Integration (DB)             | Jest + real Postgres (Supabase CLI local or docker-compose)           | migrations apply; repositories; scheduler leases (`SKIP LOCKED`); unique-notification guarantee; recovery sweep; Source→DB, DB→Validation, Validation→Matching, Matching→Notification                             | CI + pre-push            |
| API e2e                      | Supertest against Nest app with test DB + fake auth (signed test JWT) | every endpoint's happy path + auth/ownership/validation errors                                                                                                                                                    | CI                       |
| Web unit                     | Vitest + Testing Library                                              | components (JobCard states, filters ↔ URL params, forms with Zod)                                                                                                                                                 | CI (Gemini)              |
| Browser e2e                  | Playwright                                                            | login → onboarding → dashboard → job detail → apply link → tracker (against seeded local stack)                                                                                                                   | nightly / before release |
| Pipeline e2e                 | Jest "golden path"                                                    | fixture source (recorded Greenhouse JSON) → scan → normalize → dedupe → validate (fake HTTP with recorded pages) → fresher → match (fake AI) → notification row → API returns job with apply link                 | CI                       |
| Chaos/reliability (Phase 10) | Jest scenarios                                                        | each failure in the spec's list, asserting the loop continues and state is recoverable                                                                                                                            | CI                       |

Coverage targets: `packages/validation` ≥ 90 %, `packages/ai` ≥ 85 %, `apps/api` services ≥ 75 %, overall ≥ 70 %. No live network in CI (except optional `AI_LIVE_TESTS`).

## 2. Fixtures

- `apps/api/test/fixtures/sources/` — recorded responses: greenhouse (2 boards), lever, ashby, smartrecruiters, workable, remotive, 2 RSS feeds, adzuna; include one malformed record each.
- `fixtures/pages/` — application pages: open, closed (per ATS), 404, redirect chain, blocked (403 page), login-walled, page with fee request, page with UPI id.
- `fixtures/jobs/` — 60 JDs labelled with expected `experience_level`, `category`, `role_family`, salary, location; sourced from real-style Indian fresher postings (paraphrased, no company PII).
- `fixtures/resumes/` — 3 synthetic resumes (PDF/DOCX/one scanned image to assert graceful failure).
- `fixtures/ai/` — recorded provider outputs incl. invalid JSON, truncated JSON, schema-violating JSON.

## 3. Failure-scenario matrix (Phase 10 acceptance)

| Scenario                                                 | Test asserts                                                                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Source unavailable (ECONNREFUSED)                        | scan FAILED, backoff, other sources scanned in same tick                                                          |
| 403 / 404 from site                                      | DEGRADED/BLOCKED handling; no retries beyond policy; no evasion                                                   |
| Timeout                                                  | TIMED_OUT within `SOURCE_SCAN_TIMEOUT_MS`, lease released                                                         |
| Application URL redirects                                | chain recorded, final URL used, relationship computed on final host                                               |
| No salary/experience info                                | nulls stored, UNKNOWN experience → AI classify path or badge                                                      |
| Ambiguous fresher eligibility                            | rules UNKNOWN → AI → evidence merged; AI down → UNKNOWN kept & visible                                            |
| AI fails / invalid JSON                                  | repair → retry → fallback; job `AI_PENDING`; deterministic score present                                          |
| DB temporarily fails                                     | tick aborts cleanly; next tick resumes; no half-written jobs                                                      |
| Telegram fails                                           | PENDING with backoff; WEB inbox has it; no duplicate after retry                                                  |
| Duplicate job across 3 sources                           | one canonical job, 3 mappings, one notification                                                                   |
| Same company, multiple similar jobs                      | distinct jobs when location/external id differ                                                                    |
| Scanner crash mid-scan (simulated throw after N records) | ingested records persist; run orphaned → FAILED by sweep; cursor not advanced; rerun completes without duplicates |
| Worker restart                                           | leases cleared; heartbeat resumes; nothing lost                                                                   |
| Internet down                                            | all sources DEGRADED, heartbeat continues, recovery when back                                                     |
| Job closes after discovery                               | re-check → EXPIRED; hidden; tracker intact; no new notification                                                   |
| Budget exhausted                                         | AI_PENDING queue drains next day                                                                                  |

## 3a. Test environment (F1, D101)

Integration and e2e tests never touch production. They run against a **local Supabase stack** (Postgres, Auth, Storage in Docker via the Supabase CLI), started fresh in CI for every run.

- `pnpm test:db:start` starts the stack (generating an ES256 signing key on first use, so tokens verify against the JWKS exactly as in production) and writes `apps/api/.env.test` from it. `pnpm test:db:seed` applies migrations and the seed; `pnpm test:db:reset` wipes the app schema and auth users first. `pnpm test:db:stop` stops it.
- The e2e suites and both scripts load **`apps/api/.env.test` only** — never `.env`, which holds production settings and the real bot/AI keys.
- **Guard:** `assertTestTarget` (`packages/config/src/database-target.ts`) runs before any suite (Jest `setupFiles` and `globalSetup`) and in the scripts. It aborts unless every `DATABASE_URL`, `DATABASE_DIRECT_URL` and `SUPABASE_URL` is local or the project named in `TEST_SUPABASE_REF`, and always aborts on `PRODUCTION_SUPABASE_REF` — even if a typo names production as the test project. Verified: with production configured both `pnpm test:e2e` and `pnpm test:db:reset` refuse before connecting.
- Without `.env.test` the database suites skip themselves. Running them on a laptop needs Docker (Docker Desktop is free for personal use); otherwise rely on CI's `e2e` job.
- Supabase's free plan allows two projects and both are in use, which is why the test environment is local rather than a second hosted project. `TEST_SUPABASE_REF` exists for a hosted test project should one become available.

## 4. Quality gates

- `pnpm lint && pnpm typecheck && pnpm test` must pass before every commit that ends a phase (spec loop: RUN → TEST → DEBUG → VERIFY).
- CI (`.github/workflows/ci.yml`): install → lint → typecheck → unit → integration (Postgres service container) → web unit → build. Playwright job optional/nightly.
- PR template requires: what changed, tests added, docs updated, owner (Claude/Gemini).
