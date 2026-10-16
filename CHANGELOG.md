# Changelog

All notable changes, grouped by roadmap phase (docs/architecture/16-roadmap.md).

## [Phase 12] App icon — 2026-10-16

- **New 3D icon:** an indigo tile with a raised, bevelled shield, a green "verified" check and an AI sparkle. One master SVG (`apps/web/public/icons/jobsentinel.svg`) generates the favicon (16/32/48), the SVG tab icon, the Apple touch icon, install icons (192, 512, maskable) and the 1200×630 link-preview image: `pnpm --filter @jobsentinel/web icons`.
- It replaces the default Next.js/Vercel favicon, the generic shield glyph in the sidebar and mobile header, and appears on every sign-in page and onboarding. A web app manifest makes the site installable. The unused template images (`vercel.svg`, `next.svg`, …) are gone.

## [Phase 12] Open sign-up — 2026-10-16

- **Anyone can create an account** on the deployed site (D93); `ALLOWED_SIGNUP_EMAILS` still restricts an instance when set to a list.
- **Per-user AI limit.** The AI budget is shared by every account, so each user may cause at most 5 real AI resume analyses per rolling 24 hours; after that the resume is analysed by the deterministic rules. Calls are now attributed to the user in `ai_calls`, so deleting and re-uploading does not reset the count.
- Sign-up and error wording no longer describe the site as private.
- Tests: API e2e +2 (`resume-limits.e2e-spec`).

## [Phase 12] Faster page loads — 2026-10-16

- **Render no longer sleeps (D92).** The free API instance slept after 15 idle minutes, so the first visit afterwards hung for 30-60 s; a GitHub Actions job now pings `/health` every 10 minutes.
- **Vercel renders in Mumbai.** Server code ran in US East by default while the user, API and database are in Asia; `apps/web/vercel.json` pins it to `bom1`.

## [Phase 12] Sign-up and password reset — 2026-10-16

- **`/signup`** creates an account (email, password, confirmation; 8+ characters). It asks the API's new public `POST /auth/signup-check` first, so an email outside `ALLOWED_SIGNUP_EMAILS` is refused before Supabase creates anything. A confirmation email follows; its link signs the user in and continues to onboarding (D91).
- **`/forgot-password`** emails a reset link and answers the same whether or not an account exists. **`/reset-password`** sets the new password from that link, refuses a mismatch or the current password, and explains an expired or reused link. The login page links to both.
- Sign-in errors are in plain words ("Wrong email or password.", "Confirm your email first…").
- Tested end to end against the live Supabase project: account confirmation, password sign-in before and after confirming, reset with old/new password checks, reused and missing links, and refusal of a non-allowed email (which never reached Supabase). Supabase's built-in email sender allows only a few emails per hour — `docs/deployment.md` now says to configure SMTP for real use.
- Tests: web 20, API e2e +3 (`auth.e2e-spec`).

## [Phase 12] Magic-link sign-in on the deployed site — 2026-10-15

- **Cause (D87):** Supabase falls back to the project's Site URL whenever `emailRedirectTo` is not on its Redirect URLs allow-list. The Site URL was `https://jobsentinel.vercel.app` — not this site (`jobsentinel-ai.vercel.app`) and an unclaimed Vercel subdomain — so every magic link, with its one-time token, went to a dead domain anyone could claim. Fix: set the Site URL and Redirect URLs in Supabase (now step 3 of `docs/deployment.md`).
- The proxy forwards an auth `code`, `token_hash` or Supabase `error` that lands outside `/auth/callback` (e.g. on the Site URL root) instead of discarding it on the way to `/login`.
- `/auth/callback` also handles `token_hash` links and Supabase's error redirects, and reports why it failed; the login page shows that reason and switches to "Send magic link". It previously sent every failure back to a blank form.
- `docs/deployment.md` also notes that the API's `WEB_ORIGIN` (CORS) must be the deployed web URL.
- **GitHub Actions had stopped working (D88).** Every scheduled worker tick failed at install/build since web began depending on `@jobsentinel/types` (the worker's `!@jobsentinel/web...` filter skipped zod), so nothing was scanned on the free-tier setup; CI failed at pnpm setup (version given twice). Fixed both, plus two faults that were hidden behind them: CI's web build now has placeholder public Supabase values, and `db.e2e-spec` skips instead of crashing without secrets. Once those ran, two more surfaced and were fixed: CI linted before building the packages (1121 unresolved-type errors on a fresh checkout), and ran Node 22, where Jest cannot load the ESM-only `htmlparser2` (CI now uses Node 24; runtimes stay on 22). CI passes end to end. The scheduled worker now installs and builds, and stops only because the repository has no Actions secrets.
- **Render deploys failed and CORS stayed on localhost (D89).** The API refused to boot with a `WEB_ORIGIN` lacking `https://`, and a trailing slash would have booted but blocked every browser request. Origins are now normalized (scheme defaulted, slash and path dropped, comma-separated list allowed), and `render.yaml` asks for `WEB_ORIGIN` instead of the unused `CORS_ORIGINS`. Reproduced and verified by replaying the Dockerfile on Linux.
- **Redirect loop for a refused email (D90).** A signed-in email outside `ALLOWED_SIGNUP_EMAILS` bounced between `/dashboard` and `/login` until the browser gave up. It is now signed out and told why. The magic-link form no longer creates Supabase accounts for unknown emails, and says so in plain words.
- Tests: web 16 (was 3), config 19 (was 10).

## [Phase 10] End-to-end pass — 2026-10-15

A full browser walkthrough (sign-in → onboarding → dashboard → jobs → tracker → resume → system) as a throwaway user, plus one live worker tick. The automated suites were green before and after; every defect below was found only by using the product.

- **Company domains borrowed across employers (D83).** The normalizer gave every job from a single-company source that source's domain, even when the posting named another employer. Keyword searches such as "Adzuna: Cisco India" return many employers, so Brillio was verified against cisco.com. New jobs take the fallback domain only when `isSameCompany` agrees (exact name, acronym, or whole-word prefix — so HPE's "Hewlett Packard Enterprise" postings keep hpe.com). `pnpm repair:domains` cleared 116 borrowed domains and re-queued 22 live jobs for validation.
- **India-only gate dropped Indian towns (D84).** Adzuna's `display_name` names only the town ("Chandgad, Kolhapur"), so the country never resolved and Graduate Engineer Trainee roles from the India board were filtered as "outside India (unknown)". The adapter now appends the country from `location.area`; `pnpm repair:adzuna-locations` recovered 8 stored jobs from their raw payload.
- **"Multiple sources" that were one provider (D86).** Company verification credited `MULTI_SOURCE` per source row, so two Adzuna searches returning the same posting verified Brillio with no known domain. It now counts independent providers; 6 cached verifications were reset and 14 jobs re-validated.
- **Listed jobs that failed the owner's settings (D86).** Gates added after a job was classified never applied to it: 250 of 323 listed jobs were outside India, outside the monitored categories, or senior roles in fresher-only mode. `pnpm refilter` re-applies the pipeline's own decision (rules-only, saved/tracked jobs untouched) and filtered them; it replaces an uncommitted backfill script that re-implemented part of the rules.
- **Verification evidence rendered without labels.** The engine stores `{ check }`, the contract says `{ code }`; the API passed the jsonb through with a cast. `toEvidenceItems` maps it at the boundary.
- **Re-uploading a resume never updated the profile (D85).** The Resume page uploaded and stopped, so matching kept the old profile. It now reuses the onboarding review step (`PUT /profile`) and shows the confirmed profile.
- Web: the whole UI rendered in the browser's serif fallback (`--font-sans` referenced itself); selects showed raw values (`UNTRACKED`, `60d`) instead of labels; job titles vanished in the five-column Applications board; System requested the admin-only `/sources` for every user (403); eight pages had no title; the job page nested two `<main>` landmarks; the tracker kept "Not Tracking" after the server recorded "Viewed". The job list reused its measured row nodes as loading skeletons on every filter change (same element type and keys), so the virtualizer kept observing nodes with no `data-index`; the two wrappers are now keyed apart.
- Tests: 359 unit (101 api, 228 validation, 30 in the other packages and web) + 87 e2e.

## [Phase 10–12, partial] Reliability and deployment — 2026-09-23

Worked autonomously overnight at the user's request; `apps/web` was taken over from Gemini for the same reason.

- **AI pacing (D58).** Running the worker unattended showed that a daily budget cannot protect a per-**minute** limit: Gemini's free tier allows 15 requests/minute, and one classify/match batch burned it in seconds — after which every remaining call failed 429, and the failures themselves spent more quota. `AIService` now spaces calls by `AI_MIN_REQUEST_GAP_MS` (default 4.5 s ≈ 13/min) and parses the provider's own "retry in Ns" hint into a cooldown that later calls wait out. A tick that previously produced a wall of 429s now completes with none.
- **Fresher gate (D59).** A real Telegram alert read "at least 2 years · Fresher ✓" — the evidence list had already recorded the parsed years as NEGATIVE while the verdict said fresher-eligible. A stated minimum of 2 years is now decisive: EXPERIENCED on its own, and UNKNOWN (routed to the AI) when the posting also claims to welcome freshers, because believing a phrase over a stated number is the exact failure the fresher gate exists to prevent. 28 jobs were mislabelled, 6 already surfaced; all 28 reclassified to FILTERED_OUT. The 72-posting accuracy gate still passes.
- **`pnpm clean:test`**: a killed e2e run had left 24 fixture jobs scoring 100 % at the top of the real dashboard, because its `afterAll` never ran. The script removes fixtures by their `<suite>-<timestamp>` tag, deletes children before parents to respect the `ON DELETE RESTRICT` references, and has a `--dry` mode.
- **Deployment**: a multi-stage `apps/api/Dockerfile` serving both entrypoints from one image, so the API and worker can never drift apart on matching or validation rules; a `render.yaml` blueprint; a GitHub Actions schedule running `--once` ticks; and `docs/deployment.md` as the runbook — including why the worker must not live on Render's sleeping free tier, and why exactly one process may poll Telegram.
- The Docker image is **written but unbuilt**: Docker is not installed on this machine, so it has never been verified. Build it once before relying on it.
- `STATUS.md` added as the resume point for a fresh session, and the README now reflects that the system runs end to end.

## [Phase 9] Notifications — 2026-09-23

- `@jobsentinel/validation`: `decideNotification` — the pure rule that decides instant / digest / nothing, with quiet hours resolved in the user's own timezone (windows crossing midnight and DST transitions included). An unconfirmed job is never pushed; it can only ever be summarised, and only if the user opted in.
- `TelegramClient`: Bot API over `HttpClient`, so there is still exactly one outbound path with the SSRF guard, timeouts and body caps. No SDK. Paced to 1 message/second, honours `retry_after` on 429, and distinguishes permanent failures (blocked bot, dead chat, bad token) from retryable ones.
- Message formatters: instant alert, daily digest and system alert. Every employer-supplied string is HTML-escaped — an unescaped `<` in a title would otherwise truncate the whole message — and the verification line (company verified / apply link verified / host) is never omitted, so an alert always carries its evidence.
- `NotificationsService` decides and records; `DispatcherService` delivers. The split is deliberate: the row exists before any network call, so a Telegram outage delays an alert and never loses one. `ON CONFLICT DO NOTHING` against the `(user_id, job_id, channel, type)` unique index is the "never notify twice" guarantee.
- `DigestService`: one digest per user per **local** day, enforced by the `(user, channel, digest_date)` index rather than by timing.
- `TelegramPollerService`: long-poll linking (`/start <code>`, 15-minute codes, one chat per user), the `/status` `/digest` `/pause` `/resume` `/help` commands, and the Save / Not-interested inline buttons — which route through the same services the web UI uses. Messages from unlinked chats are ignored. The `getUpdates` offset is persisted in the new `system_state` table so a restart never replays old messages.
- API: `GET /notifications` (web inbox, cursor-paged), `/notifications/summary`, `/notifications/:id/read`, `/notifications/read-all`, `GET/PUT /notifications/settings`, `POST /notifications/test`, `POST /telegram/link` and `/telegram/unlink`.
- Worker gained four isolated stages: `notify` → `dispatch` → `digest` → `telegram`.
- Migration 0002 adds `system_state`; `pnpm --filter @jobsentinel/api notify [--digest] [--dispatch-only] [--user=]` added.
- Tests: 13 decision-rule unit tests, 16 formatter tests and 8 integration tests against the live database — duplicate prevention, delivery to both channels, "the web alert survives a Telegram outage and the Telegram one retries", ineligible jobs never alerted, one digest per local day, and system-alert rate limiting. 269 unit + 80 e2e in total.
- **Verified live**: four real Telegram alerts delivered to a real account for four real validated jobs (top match Thoughtworks "Developer (Vapasi) – Intern", 98 %), each with a working APPLY button. This is Phase 9's definition of done.
- Two defects found by that live run and fixed: Telegram rejects an inline keyboard containing a `localhost` URL and drops the entire message (D56), and the classification integration test had assumed no real account monitors `DATA` (D57).
- `docs/notifications.md` added; decisions D56–D57 recorded.

## [Phase 8 — API half] Jobs, tracker and dashboard endpoints — 2026-09-23

Claude's half of Phase 8 (docs 16). The UI is Gemini's and is tracked separately.

- `@jobsentinel/types`: the full read contract as shared DTOs — `JobsQuery` (20 filters, three sorts, cursor), `JobCard`, `JobDetail`, `TrackerState`, `ApplicationItem`, `DashboardSummary`, plus the `ApplicationUpsert`/`NotInterestedInput` bodies. Array filters accept `?category=A&category=B` or `?category=A,B`, because both reach a browser-built query string in practice. The web app imports these instead of hand-writing them, so the two halves cannot drift.
- `GET /jobs`: every documented filter (text search over the indexed title+description document, role family, category, company, location, remote, fresher, experience level, score, priority, validation status, activity, posted-after, source, salary, saved, tracker state) with `newest` / `score` / `posted` sorting and keyset pagination. A corrupt cursor restarts the list rather than erroring.
- Scores are pinned to the user's current `profile_version`: a score computed against an older resume is shown as no score at all, never as if it were current.
- Unconfirmed jobs are opt-in. The default is `validationStatus=VALID`; `NEEDS_REVIEW` appears only when asked for.
- `GET /jobs/:id`: description, requirements, skills, all source mappings, the validation evidence list and the full score breakdown, including `aiPending` when a match scored above the pre-filter but never got an AI verdict.
- Tracker: `POST /jobs/:id/view|save|not-interested`, `DELETE /jobs/:id/save`, `GET /saved-jobs`, `GET/PUT/DELETE /applications`. "Not interested" marks the user's tracker and never touches the posting, so the decision is reversible (spec principle 9). An `APPLIED` status dates itself, and that date survives later status changes; history is appended, never rewritten.
- `GET /dashboard/summary`: fourteen counters in a single statement of scalar subqueries, plus the five newest and five best-matching cards and worker/source health.
- `GET /system/status` now reports today's AI usage against both daily budgets, completing the accounting added in Phase 7.
- Tests: 14 integration tests against the live database, each request made as a real Supabase user with a real JWT so the guard, the Zod query pipe and the response envelope are all exercised. 240 unit + 72 e2e in total.
- Three defects found and fixed while testing: a JS `Date` inside a raw `sql` template throws at runtime (D55, hit three queries); `/dashboard/summary` fanned out 8 parallel queries and could stall (D54); and `saved_jobs`/`applications` reference `jobs` with `ON DELETE RESTRICT`, which the test cleanup had to respect.
- Decisions D54–D55 recorded.

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
