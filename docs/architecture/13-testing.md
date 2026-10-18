# 13 — Testing Strategy

## 1. Pyramid

| Layer                        | Tooling                                                               | Scope                                                                                                                                                                                                             | Runs                      |
| ---------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Unit (pure)                  | Jest (`packages/*`, `apps/api`)                                       | normalization, fresher rules, suspicion patterns, domain relationship, dedupe keys/SimHash, salary/location extraction, scorer, priority bands, JSON repair, env schema                                           | every commit, < 30 s      |
| Unit (services)              | Jest + fakes                                                          | `SourceManager`, `DedupeService`, `ValidationOrchestrator`, `MatchingService`, `NotificationDispatcher`, `SchedulerService` with `FakeHttpClient`, `FakeAIProvider`, `FakeTelegram`, `FakeClock`, in-memory repos | every commit              |
| Integration (DB)             | Jest + real Postgres (Supabase CLI local or docker-compose)           | migrations apply; repositories; scheduler leases (`SKIP LOCKED`); unique-notification guarantee; recovery sweep; Source→DB, DB→Validation, Validation→Matching, Matching→Notification                             | CI + pre-push             |
| API e2e                      | Supertest against Nest app with test DB + fake auth (signed test JWT) | every endpoint's happy path + auth/ownership/validation errors                                                                                                                                                    | CI                        |
| Web unit                     | Vitest + Testing Library                                              | components (JobCard states, filters ↔ URL params, forms with Zod)                                                                                                                                                 | CI (Gemini)               |
| Browser e2e                  | Playwright (`e2e/`, F9)                                               | sign-up → onboarding with a resume → job filters (India, domain, salary, recency) → tracker persists across reload (against the seeded local stack)                                                               | every push (CI `e2e` job) |
| Pipeline e2e                 | Jest "golden path"                                                    | fixture source (recorded Greenhouse JSON) → scan → normalize → dedupe → validate (fake HTTP with recorded pages) → fresher → match (fake AI) → notification row → API returns job with apply link                 | CI                        |
| Chaos/reliability (Phase 10) | Jest scenarios                                                        | each failure in the spec's list, asserting the loop continues and state is recoverable                                                                                                                            | CI                        |

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
- Without `.env.test` the database suites skip themselves. On a laptop they need Docker Desktop (free for personal use; `winget install -e --id Docker.DockerDesktop`), running before `pnpm test:db:start`. Verified on the owner's Windows machine: 14 suites, 93 of 93, plus `test:db:reset`.
- The pre-commit hook always refuses `.env*` files (including `.env.test`), `supabase/signing_keys.json` and any staged private JWK, so neither the local keys nor the signing key can be committed by accident; CI's gitleaks scan is the second line.
- Supabase's free plan allows two projects and both are in use, which is why the test environment is local rather than a second hosted project. `TEST_SUPABASE_REF` exists for a hosted test project should one become available.

## 4. Quality gates

- `pnpm lint && pnpm typecheck && pnpm test` must pass before every commit that ends a phase (spec loop: RUN → TEST → DEBUG → VERIFY).
- CI (`.github/workflows/ci.yml`): install → lint → typecheck → unit → web unit → build; the `e2e` job starts the local Supabase stack and runs the API e2e suites, then the Playwright browser suite on the same stack (F9, D122) on every push.

## 4a. Browser tests (F9, D122)

`e2e/` is its own workspace package (`@jobsentinel/e2e`). Run it locally with `pnpm test:db:start && pnpm test:db:seed && pnpm --filter @jobsentinel/api build && pnpm test:browser`.

- `playwright.config.ts` starts the built API and a fresh `next build && next start` of the web app, both with an explicit environment.
  - The API runs from `e2e/` (no `.env` there), and every AI, Telegram and Adzuna key is set to empty, so dotenv cannot supply a real one.
  - The web build gets `NEXT_PUBLIC_*` for the local stack, never `apps/web/.env.local`.
- `loadTestEnv()` refuses any non-local database (`assertTestTarget`).
- Global setup seeds five `Zorblax …` jobs (India, remote abroad, India network role 20 days old, on-site abroad, 70 days old) and a generated resume PDF. Teardown removes the jobs and the throwaway `zorblax-*@jobsentinel.test` users, with their tracker rows and resume files. Teardown also runs before seeding, so a killed run leaves nothing behind.
- The journey, in order:
  1. sign-up;
  2. onboarding with the resume (no AI key: the rules parser);
  3. India and remote listed, on-site abroad and stale never;
  4. `category=NETWORK`;
  5. "Last 7 days";
  6. salary minimum with "include undisclosed" on and off, and "Not disclosed";
  7. mark Applied, reload, persists, exactly one tracker row.
- Chromium only, one worker, no retries; traces and screenshots are kept on failure and uploaded by CI. Verified 3/3 green locally on 2026-10-18 before enabling it in CI.
- PR template requires: what changed, tests added, docs updated, owner (Claude/Gemini).
