# AGENTS.md — Rules for Claude and Gemini working on JobSentinel AI

Both agents **must read this file before modifying any code**. It is the operational summary of the architecture package in `docs/architecture/` — when this file and those docs disagree, fix whichever is wrong and say so.

## 1. Project overview

JobSentinel AI is a personal, free-first job discovery → verification → matching → notification system for a final-year engineering student seeking fresher/entry-level engineering roles. It continuously scans **permitted** public job sources, validates listings with evidence, matches them to the user's resume profile, and alerts via Telegram + a responsive web dashboard. It must feel like a real product: reliable, explainable, secure, mobile-friendly.

Non-negotiables (from the spec):

1. Never bypass CAPTCHA, logins, anti-bot systems, `robots.txt`, rate limits, paywalls or access controls. Unsupported source ⇒ not supported. No "trying harder".
2. AI is never the sole decider of job legitimacy or fresher eligibility. Deterministic rules + evidence first; AI is a bounded, Zod-validated signal.
3. AI layer is provider-independent (`AIProvider` interface; Gemini / Claude / local adapters). No vendor SDK outside `packages/ai`.
4. Never lose a job because a scan failed (cursor never advances on failure; idempotent upserts).
5. Never notify twice for one canonical job (DB unique index).
6. Secrets stay server-side; resume data stays private and minimal when sent to AI.
7. ₹0 development cost; every paid dependency needs a documented free alternative.

## 2. Architecture in one paragraph

Three deployables, one database: **web** (`apps/web`, Next.js 16 App Router on Vercel), **api** (`apps/api/src/main.ts`, NestJS 11 REST on Render/VM) and **worker** (`apps/api/src/worker.ts`, same Nest codebase, no HTTP, runs the scheduler/pipeline; supports `--once` for cron hosts). Supabase provides Postgres, Auth and private Storage. Shared packages: `@jobsentinel/types` (Zod schemas/enums/DTOs), `@jobsentinel/validation` (pure rules), `@jobsentinel/ai` (provider-independent AI), `@jobsentinel/config` (env schema + taxonomy). Pipeline: `DISCOVERED → CLASSIFIED → VALIDATING → VALID|SUSPICIOUS|NEEDS_REVIEW|EXPIRED|REJECTED → MATCHED → NOTIFY_PENDING → NOTIFIED`, driven by `jobs.status` and Postgres row leases (no Redis). Full detail: `docs/architecture/01-system-architecture.md`.

## 3. Folder structure

```
apps/web        Next.js frontend (Gemini)      — app/, components/, hooks/, lib/, proxy.ts
apps/api        NestJS API + worker (Claude)   — src/{common,auth,users,resumes,jobs,sources,scheduler,validation,matching,notifications,system}, test/
packages/types  Zod schemas, enums, API DTOs   (Claude; consumed by both)
packages/validation  pure deterministic rules   (Claude)
packages/ai     AIService + adapters + prompts (Claude)
packages/config env schema, taxonomy, constants (Claude)
docs/           architecture package + long-lived docs
scripts/        db, backup, ops scripts
.github/        CI
```

## 4. Ownership and coordination (docs/architecture/15-responsibility-split.md)

| Path                                                                                   | Owner      | Notes                                                                                   |
| -------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------- |
| `apps/web/**`                                                                          | **Gemini** | Claude reviews; Claude may touch auth wiring (`lib/supabase/*`, `proxy.ts`) with a flag |
| `apps/api/**`, `packages/**`, `docs/**`, root configs, `.github/**`, `scripts/**`      | **Claude** | Gemini requests changes (e.g. new API fields) rather than editing                       |
| `AGENTS.md`, `README.md`, `.env.example`, `package.json` (root), `pnpm-workspace.yaml` | Claude     |                                                                                         |

Rules: contract-first (DTOs in `packages/types` + `docs/architecture/03-api-contract.md` change **before** UI code uses them); never edit the same file in parallel; flag any cross-boundary edit explicitly; one agent per commit; Gemini never queries Supabase tables directly from the browser — all data goes through the API.

## 5. Coding standards

- **TypeScript strict** everywhere (`tsconfig.base.json`): `noUncheckedIndexedAccess`, no `any` in app code (tests may relax `no-unsafe-*`).
- **Zod at every boundary**: HTTP bodies/queries, env, AI outputs, source payloads, file uploads. Infer types from schemas; never hand-write a type that a schema already defines.
- **Prettier** (single quotes, 100 cols, trailing commas) and **ESLint** (type-checked rules; `--max-warnings 0`). Run `pnpm lint && pnpm format:check` before committing.
- **Imports**: `import type` for types; no default exports in packages/api (Next.js pages excepted).
- **Errors**: throw `AppError` subclasses in the API (mapped to the error envelope); never swallow errors silently — log with context and continue where the design says so (pipeline isolation).
- **Logging**: pino via `createLogger`; never log resume text, tokens, secrets, full job descriptions. Business events go to `system_logs` via `AuditLogger`.
- **No `process.env` outside `packages/config`** (API/worker) or `apps/web/lib/env.ts` (web, `NEXT_PUBLIC_*` only).
- **Comments** explain _why_, not _what_; reference the architecture doc section when implementing a designed behaviour (e.g. `// docs 07 §2.1`).
- Prefer small pure functions in `packages/validation` over logic inside Nest services; services orchestrate, packages compute.

## 6. Naming conventions

| Thing                      | Convention                                                                         | Example                                                     |
| -------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Files                      | kebab-case                                                                         | `worker-loop.ts`, `login-form.tsx`                          |
| Nest classes               | PascalCase + suffix                                                                | `ValidationOrchestrator`, `JobsController`, `SourceManager` |
| DB tables/columns          | snake_case, plural tables                                                          | `job_source_mappings.external_id`                           |
| Postgres enums / Zod enums | SCREAMING_SNAKE values                                                             | `NEEDS_REVIEW`                                              |
| Env vars                   | SCREAMING_SNAKE with area prefix                                                   | `AI_GEMINI_API_KEY`, `WORKER_TICK_MS`                       |
| API routes                 | plural nouns, kebab-case, `/api/v1`                                                | `/api/v1/saved-jobs`                                        |
| React components           | PascalCase, one per file                                                           | `JobCard`                                                   |
| Hooks                      | `useX` in `apps/web/hooks`                                                         | `useJobs`                                                   |
| Tests                      | `*.test.ts` (packages/web unit), `*.spec.ts` (api unit), `*.e2e-spec.ts` (api e2e) |                                                             |
| Branches / commits         | `phase-N-name`; Conventional Commits with scope                                    | `feat(api): [P4] greenhouse adapter`                        |

## 7. Database rules (docs/architecture/02-database.md)

- Drizzle schema in `apps/api/src/common/db/schema/`; SQL migrations generated by drizzle-kit, committed, applied manually (`pnpm db:migrate`), never auto-applied in prod.
- `uuid` PKs, `timestamptz` UTC, `created_at/updated_at` on every table, Postgres enums mirrored in `packages/types/src/enums.ts` (keep both in sync; a test asserts it from Phase 3).
- Every user-owned table has `user_id` and an RLS owner policy; shared tables (jobs, companies, sources) are read-only for `authenticated`.
- Natural-key uniques are the idempotency mechanism: `(source_id, external_id)`, `(job_id, user_id, profile_version)`, `(user_id, job_id, channel, type)`.
- Writes in the pipeline are per-record transactions; selection uses `FOR UPDATE SKIP LOCKED`.
- Batch writes rather than per-row round trips over the pooler, and flush a long stage incrementally (≤ 50 rows or ≤ 60 s): never hold a pooled connection idle across AI or HTTP calls (D37, D44, D51).
- Keep concurrent queries per request at or below the pool `max` (4 in dev): prefer one statement with scalar subqueries over a fan-out of counters (D54).
- A JS `Date` inside a raw `sql` template has no encoder — pass `date.toISOString()` with an explicit `::timestamptz` cast. Typed helpers (`gte(col, date)`) take a `Date` as normal (D55).
- Never delete saved/applied jobs; retention rules in docs 02 §8.

## 8. API conventions (docs/architecture/03-api-contract.md)

- Prefix `/api/v1`; bearer Supabase JWT on everything except `/health*`.
- Envelope `{ data, meta }` / `{ error: { code, message, details?, requestId } }`; cursor pagination.
- Every request validated by `ZodValidationPipe` with a schema from `packages/types/src/api`.
- Ownership enforced in services (`user_id = current user`), admin routes behind `AdminGuard`.
- Additive changes only within v1.

## 9. AI rules (docs/architecture/09-ai.md)

- Only `packages/ai` imports vendor SDKs. Callers use `AIService.run(AIRequest)` and get `AIResult<T>` (never throw for provider failure).
- Every purpose has: versioned prompt file, Zod output schema, deterministic fallback, cache key, budget accounting (`ai_calls`).
- Redact PII from resume text before sending; send minimal job fields; never send user email/tokens.
- AI influence is bounded: validation ±0.2 max; match skill/role scores within ±25 of deterministic values.
- Budget priority (D105): resume parsing > fresher checks > matching > requirements/suspicion > category; each purpose stops at its tier's share of the daily budget (`budget-priority.ts`).
- The AI may decide a job's **category only** when rules cannot (D105); location, batch, experience and recency stay deterministic and run first. Unsure → the job is held (`NEEDS_REVIEW`), never notified.
- Model names come from env, never hard-coded.

## 10. Validation rules (docs/architecture/08-validation.md)

- Rules + evidence weights live in `packages/validation`; the Nest `validation` module orchestrates I/O (URL probe, DNS).
- Every result carries `evidence[]` and `confidence`; the UI shows evidence, never a bare score.
- Ambiguous ⇒ `NEEDS_REVIEW`, never silently VALID or silently dropped.
- Scam patterns are versioned with unit tests for true positives _and_ known false positives.

## 10a. Matching rules (docs/architecture/09-ai.md §5)

- The deterministic scorer in `packages/validation/src/match` always runs and is always stored; the AI may only refine `skillScore`/`roleScore` within ±25 of it, and only for jobs already scoring ≥ 35.
- A score never rejects a job: low matches are stored and ranked, never deleted or hidden.
- Location: a job is listed if it is in India **or remote, whatever country it names** (D73, D102); on-site jobs abroad are filtered at classification, and the list applies the same rule.
- Only roles that accept zero experience are listed (`isFresherRole`, D96): a stated minimum of 0 years with any upper end ("0-5 years"), or no stated years and a fresher/entry-level classification. Classification filters the rest before matching, and the read path applies the same rule (`fresherRoleSql`). Unknown experience with no stated years is listed only when the AI places it.
- Every match row carries its `profile_version`. Editing a profile bumps the version and re-scores; old rows stay for history.
- Scores are per user — `(job_id, user_id, profile_version)` is the idempotency key, so re-running a match run is always safe.

## 10b. Notification rules (docs/architecture/10-notifications.md)

- Two channels, one decision: the WEB inbox row is always written, Telegram is best-effort on top. An outage delays an alert, never loses one.
- `(user_id, job_id, channel, type)` is unique and every insert is `ON CONFLICT DO NOTHING` — "never notify twice" is enforced by the database, not by code.
- A job that is not `VALID` is never sent to Telegram — not instantly, not in the digest (D106). Held (`NEEDS_REVIEW`) jobs appear only in the Needs review view (`GET /jobs/needs-review`), with why each is held.
- Every alert carries its evidence (verification line, matched/missing skills), never a bare score.
- All employer-supplied text is HTML-escaped before it reaches Telegram, and button URLs must be public (D56).
- Quiet hours and the digest hour are evaluated in the user's timezone, not the server's.
- Each user links their own chat and alerts go only to it. In production the bot's messages reach the API by webhook (`/api/v1/telegram/webhook`, secret header), never by polling: the worker runs in short bursts (D98).

## 11. Security rules (docs/architecture/11-security.md)

- Secrets only in host env; `.env*` git-ignored; `.env.example` has placeholders only; gitleaks in CI.
- `NEXT_PUBLIC_*` is limited to Supabase URL/anon key, API URL, bot username.
- Outbound HTTP only through `HttpClient` (SSRF guard, timeouts, body caps, UA, per-host rate limit).
- Job HTML sanitized server-side with a fixed allowlist; UI never renders unsanitized HTML.
- Uploads: PDF/DOCX, ≤ 5 MB, magic-byte check, private bucket, signed URLs.
- Sign-up is open to anyone by default (`ALLOWED_SIGNUP_EMAILS=*`); a comma list restricts it. Shared resources are capped per user — e.g. AI resume analyses (D93).

## 12. Job-source rules (docs/architecture/06-job-sources.md)

- A source is supported only if it is a public API/feed or a public page allowed by `robots.txt`/terms.
- Adapters implement `JobSource`, emit `RawJob`, never classify, never evade blocks (403/429/challenge ⇒ back off, mark BLOCKED, eventually disable).
- One scan = one `scan_runs` row = one unit of failure isolation; a failed scan never advances the cursor.
- Respect per-source politeness (`min_request_gap_ms`) and documented rate guidelines.
- Before seeding/adding an ATS board, confirm the company behind the slug from its postings (slugs are global; see docs/sources.md).
- A source's company and domain apply only to postings that name that company (`isSameCompany`). Keyword searches (the Adzuna employer sources) return other employers too; lending them the domain verifies the wrong company (D83).
- All outbound HTTP goes through `HttpClient` (`HTTP_CLIENT` token); adapters never call `fetch` directly.
- A source with 20+ jobs collected and none kept over 30 days (`AUTO_PAUSE_MIN_COLLECTED`, `AUTO_PAUSE_WINDOW_DAYS`) is auto-paused (`PAUSED_AUTO`, D103, D104) and announced to admins once; errors and small samples never trigger it. India-scoped sources (Adzuna `in`, or `config.indiaScoped`) are never paused — they are alerted on once per window. Sources are never deleted; resume is `POST /sources/:id/resume`. The report card is `GET /sources/report`.

## 13. Testing requirements (docs/architecture/13-testing.md)

- Jest for `packages/*` and `apps/api` (+ Supertest e2e), Vitest + Testing Library for `apps/web`, Playwright for browser e2e.
- New business logic ⇒ unit tests in the same commit. Pipeline stages ⇒ fake-based service tests. DB code ⇒ integration tests against local Postgres.
- Classification rules live in `packages/validation/src/classify`; changing them requires re-running the accuracy gate (`apps/api/src/jobs/classification-accuracy.spec.ts`, 72 labelled postings, ≥90% required). Never tune a rule without measuring against it.
- No live network or AI calls in CI (fixtures/recordings; `AI_LIVE_TESTS=1` for manual runs). API e2e suites run against a **local Supabase stack**, never production: `pnpm test:db:start && pnpm test:db:seed && pnpm test:e2e` (CI's `e2e` job does this on every push). They read `apps/api/.env.test` only, and `assertTestTarget` aborts if any database URL is not local or the named test project (F1, D101). Without `.env.test` they skip themselves. E2E creates throwaway `*@jobsentinel.test` auth users and deletes them (plus their storage objects) in `afterAll`.
- The e2e suites run a preflight that proves the database answers before any suite starts: a paused or removed Supabase project fails once with the cause, rather than as dozens of timeouts (D78). Free-tier projects pause after inactivity — restoring one needs `pnpm db:migrate` and `pnpm db:seed` before the suites pass again.
- An orchestrator entry point that an integration test calls **must** accept a `jobIds` (or equivalent) scope, and the test **must** pass it: the suites share one database, so an unscoped batch reaches other suites' rows (and, before D101, real ones). This has bitten four times (D46, D57, D68, D77) — once writing fake-HTTP evidence into 256 production validation records.
- The repo lives under OneDrive, which can dehydrate files into placeholders that Jest silently skips. `pnpm test` runs `check:files` first and fails if any tracked file is one — never work around that failure, fix the files (D71). Record the suite totals when you change them, so a shrinking count is noticeable.
- Before ending a phase: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` must pass.

## 14. Git conventions

- `main` is always runnable. Work on `phase-N-<name>` branches; merge after the phase is verified.
- Conventional Commits: `feat|fix|docs|test|chore|refactor(scope): [P<n>] message`. Scopes: `api`, `web`, `worker`, `types`, `validation`, `ai`, `config`, `db`, `docs`, `ci`.
- One agent per commit; reference the phase; never commit `.env`, `dist/`, `.next/`.
- Never rewrite published history; never force-push `main`.

## 15. Environment variables

Declared in `packages/config/src/env.ts` (Zod, defaults, per-process requirements) and documented in `.env.example`. Add a variable in three places: schema, `.env.example`, `docs/architecture/12-folder-structure-and-env.md`. Web variables must be `NEXT_PUBLIC_*` and public-safe. The root `.env` is the single source of truth; `pnpm env:sync` copies it to `apps/api/.env` and only public vars to `apps/web/.env.local`.

## 16. Deployment notes (docs/architecture/14-deployment-and-free-first.md)

- Web → Vercel (root `apps/web`). API → Render free (Docker, `node dist/main.js`, health `/health/ready`). Worker → Oracle Always Free VM / laptop / GitHub Actions cron (`node dist/worker.js --once`). DB/Auth/Storage → Supabase free.
- Migrations run manually before deploying API/worker. Backups: weekly `pg_dump` (script in Phase 12).
- Free tiers change: the worker is portable by design; re-verify tier terms at deploy time and update the README cost table.

## 17. Local commands

```bash
pnpm install                 # workspace install (Node ≥ 22, pnpm ≥ 9)
pnpm build                   # packages → api → web (topological)
pnpm dev:api | dev:worker | dev:web
pnpm worker -- --once        # single worker tick (after build)
pnpm lint | format | typecheck | test
pnpm --filter @jobsentinel/api test:e2e
```

## 18. Phase loop

Every phase: **PLAN → IMPLEMENT → RUN → TEST → DEBUG → VERIFY → DOCUMENT → COMMIT**. Update `docs/`, `CHANGELOG.md` and this file when conventions change. Do not start the next phase until the current one runs and its tests pass.
