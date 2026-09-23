# JobSentinel — live status

**Updated:** 2026-09-23, after reviewing and testing Gemini's India-source work.
**Resuming work?** Say "continue" and it picks up at _Next up_.

## Where the project stands

| Phase                        | Owner  | State                                                 |
| ---------------------------- | ------ | ----------------------------------------------------- |
| 0 Architecture               | Claude | ✅ done                                               |
| 1 Project setup              | Claude | ✅ done                                               |
| 2 Auth + profile + resume    | Claude | ✅ done                                               |
| 3 Database                   | Claude | ✅ done (migrations 0000–0002)                        |
| 4 Job ingestion              | Claude | ✅ done — 2,600+ real postings, 32/33 sources active  |
| 5 Fresher classification     | Claude | ✅ done — accuracy gate holds at 100 %                |
| 6 Validation                 | Claude | ✅ done — evidence-based, live-verified               |
| 7 AI matching                | Claude | ✅ done, pushed                                       |
| 8 Jobs/tracker/dashboard API | Claude | ✅ done, pushed                                       |
| 8 Web dashboard UI           | Gemini | ✅ committed (carried in the Phase 11 commit)         |
| 9 Notifications (Telegram)   | Claude | ✅ done — real alerts delivered, pushed               |
| 10 Reliability               | Claude | 🟡 partial — seven live defects fixed, matrix pending |
| 11 UI shell, theme, inbox    | Claude | ✅ done, pushed                                       |
| 12 Production readiness      | Claude | 🟡 partial — Docker, Render, Actions, runbook done    |

## It is running right now

- **API** on `:4000`, **web** on `:3000`, **worker** ticking continuously.
- **Telegram bot** `@SIDJOBSENTINELBOT` linked to chat `2069167765`; alerts are arriving.
- Log in at http://localhost:3000 as `chatrasiddharth2@gmail.com` / `Siddu@2005`.

If a server is down: `node apps/api/dist/main.js`, `node apps/api/dist/worker.js`,
`pnpm --filter @jobsentinel/web dev`.

## Read this in the morning

1. **Your profile is a PLACEHOLDER.** I seeded a plausible final-year CS profile so the pipeline
   had something to score against. Upload your real resume in Onboarding → it bumps
   `profile_version` and re-scores everything automatically. Nothing needs deleting first.
2. **One alert was wrong and I fixed the cause.** A Twilio job arrived reading "at least 2 years ·
   Fresher ✓". The classifier was treating a 2-year minimum as entry-level. 28 jobs were
   affected; all 28 are now correctly filtered out (D59).
3. **Job supply is largely solved.** Gemini re-verified every board by counted India postings,
   disabled the ones with no India presence, added Razorpay, and wired up Adzuna — which has
   28,000+ India software roles. A scan now ingests 100 India jobs at a time.
4. **Gemini has nothing queued.** I took `apps/web` over at your request; AGENTS.md §4 still
   records the original split.

## Next up (in order)

1. **Phase 12 finish**: the Docker image is written but **unverified — Docker is not installed on
   this machine**, so it has never been built. Build it once before trusting it. Then Vercel
   project setup and a final security review.
2. **Phase 10 completion**: the failure-scenario matrix from docs 13 §3 and a chaos harness.
3. **UI polish**: filters belong in a sheet on mobile, applications kanban on desktop,
   Lighthouse/axe pass.

## Verified this session

- 269 unit + 80 e2e tests pass; `pnpm build` green across the workspace.
- Four real Telegram alerts delivered for real validated jobs (top: Thoughtworks "Developer
  (Vapasi) – Intern", 98 %), each with a working APPLY button.
- A worker tick that previously produced a wall of Gemini 429s now completes with none (D58).

## Decisions taken while you slept

D56 Telegram rejects localhost button URLs · D57 a test assumed no real account existed ·
D58 pace AI calls under the free tier's per-minute limit · D59 a 2-year minimum is never
fresher-eligible. Full table in `docs/architecture/00-decisions.md`.
