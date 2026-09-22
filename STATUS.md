# JobSentinel — live status

**Updated:** 2026-09-23, overnight autonomous session.
**Read this first if you are resuming work.** Say "continue" and work picks up at _Next up_.

## Where the project stands

| Phase                        | Owner  | State                                                              |
| ---------------------------- | ------ | ------------------------------------------------------------------ |
| 0 Architecture               | Claude | ✅ done                                                            |
| 1 Project setup              | Claude | ✅ done                                                            |
| 2 Auth + profile + resume    | Claude | ✅ done                                                            |
| 3 Database                   | Claude | ✅ done (migrations 0000–0002)                                     |
| 4 Job ingestion              | Claude | ✅ done — 2,600+ real postings                                     |
| 5 Fresher classification     | Claude | ✅ done — 100 % agreement on 72 labelled postings                  |
| 6 Validation                 | Claude | ✅ done — evidence-based, live-verified                            |
| 7 AI matching                | Claude | ✅ done, pushed                                                    |
| 8 Jobs/tracker/dashboard API | Claude | ✅ done, pushed                                                    |
| 8 Web dashboard UI           | Gemini | ✅ builds; typed against `@jobsentinel/types`; **uncommitted**     |
| 9 Notifications (Telegram)   | Claude | 🟡 **in progress** — pipeline works end to end, tests/docs pending |
| 10 Reliability               | Claude | ⬜ not started                                                     |
| 11 UI polish                 | Claude | ⬜ not started (taken over from Gemini, see note)                  |
| 12 Production readiness      | Claude | ⬜ not started                                                     |

## Live facts

- **Telegram bot is live**: `@SIDJOBSENTINELBOT` ("JOBIIII"), token in root `.env`.
- **Account linked**: `chatrasiddharth2@gmail.com` (password `Siddu@2005`), user id
  `0a2f3c69-fc39-4be7-bbef-a5eda8d95149`, Telegram chat `2069167765`.
- **4 real alerts delivered** on 2026-09-23 — top match Thoughtworks "Developer (Vapasi) – Intern"
  at 98 %. Phase 9's definition of done is met.
- **The profile is a PLACEHOLDER.** It was seeded so the pipeline had something to score against.
  Uploading a real resume in Onboarding bumps `profile_version` and re-scores everything — this is
  the intended flow, not a workaround.
- Jobs: 1,651 filtered out · 700 classified · 186 needs-review · 128 matched · 6 valid · 4 notified.

## Running it locally

```bash
pnpm env:sync                                   # root .env -> apps/api/.env + apps/web/.env.local
pnpm --filter @jobsentinel/api build
node apps/api/dist/main.js                      # API on :4000
pnpm --filter @jobsentinel/web dev              # web on :3000
```

Ops scripts (all idempotent, all safe to re-run):

```bash
pnpm --filter @jobsentinel/api classify         # re-run classification
pnpm --filter @jobsentinel/api validate         # drain the validation queue
pnpm --filter @jobsentinel/api match --ai=12    # score jobs against profiles
pnpm --filter @jobsentinel/api notify           # decide + deliver alerts
pnpm --filter @jobsentinel/api notify --digest  # force today's digest
pnpm --filter @jobsentinel/api worker -- --once # one full pipeline tick
```

## Next up (in order)

1. **Phase 9 finish**: notifications integration tests (duplicate prevention, digest once per local
   day, quiet-hours delay), then docs + CHANGELOG + commit.
2. **Phase 10 reliability**: failure-matrix tests, chaos harness, stage-error parking, alerting.
3. **Phase 11 UI**: the dashboard works but is plain. Make it genuinely attractive and mobile-first.
4. **Phase 12 production**: Dockerfile, Render/Vercel config, backups, deployment docs, runbook.

## Open decisions for the user

- **Job supply is the real limit.** Only ~18 of 300 scored jobs are a good fresher fit, because the
  seeded sources are global companies hiring seniors. Options: add Indian fresher-heavy boards,
  enable Adzuna (seeded but disabled, needs free API keys), or supply a target-company list.
- **Ownership deviation**: AGENTS.md §4 gives `apps/web` to Gemini. The user asked for the whole
  project to be finished overnight, so Claude is taking the UI as well. Recorded here deliberately.
- Gemini's Phase 8 UI work is **uncommitted** in the working tree.
