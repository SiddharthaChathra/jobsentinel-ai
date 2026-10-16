# Deployment and operations

Design: [architecture/14-deployment-and-free-first.md](architecture/14-deployment-and-free-first.md). This page is the runbook.

## Shape

Three deployables, one database.

| Piece      | Where                                 | Command               | Cost |
| ---------- | ------------------------------------- | --------------------- | ---- |
| **web**    | Vercel (root directory `apps/web`)    | `next build`          | free |
| **api**    | Render, Docker, `apps/api/Dockerfile` | `node dist/main.js`   | free |
| **worker** | Always-free VM, a laptop, or Actions  | `node dist/worker.js` | free |
| **data**   | Supabase (Postgres 17, Auth, Storage) | —                     | free |

The API and worker ship as **one image**, so they can never drift apart on matching or validation rules.

## Why the worker is not on Render

Render's free web services sleep after 15 minutes without HTTP traffic. A sleeping worker stops scanning silently — the worst failure mode, because the dashboard still looks fine while nothing is discovered. Pick one:

- **Always-free VM** (Oracle, Fly, a Raspberry Pi, your laptop): run `node dist/worker.js` under a supervisor.
- **GitHub Actions** (`.github/workflows/worker.yml`): one `--once` tick every 30 minutes, started by the API (D95). Free, no host to manage.

Either way the bot's incoming messages — a new user's `/start <code>` that links their Telegram, commands, buttons — go to the API, not the worker: with `TELEGRAM_MODE=webhook` the API registers `/api/v1/telegram/webhook` with Telegram on boot (D98). Long polling needs a process that never stops, so before this nobody could link Telegram on the deployed site.

## First deploy

1. **Database.** `pnpm --filter @jobsentinel/api db:migrate`, then `db:seed`. Migrations are never applied automatically — they run deliberately, before the code that needs them.
2. **API → Render.** Point it at `render.yaml`, then set every `sync: false` secret in the dashboard. Health check is `/health/ready`, which also checks the database, so a deploy with a broken `DATABASE_URL` fails to go live rather than serving errors.
3. **Web → Vercel.** Root directory `apps/web`. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_BASE_URL` (the Render URL) and `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`.
   - **Supabase → Authentication → URL Configuration.** Set **Site URL** to the web URL (`https://jobsentinel-ai.vercel.app`) and add **Redirect URLs** `https://jobsentinel-ai.vercel.app/**` and `http://localhost:3000/**`. Supabase sends a magic link only to an allow-listed `emailRedirectTo` and otherwise falls back to the Site URL _without saying so_ — a Site URL naming an unclaimed `*.vercel.app` subdomain sent every link (and its one-time token) to a domain anyone could register (D87). Verify with `generateLink` + a manual-redirect fetch: the `Location` must start with the web URL.
   - **Supabase → Authentication → Emails.** Sign-up confirmation, password reset and magic links are all emails. The built-in sender is for testing only — a handful of emails per hour project-wide — so with real use a second request fails with "Too many sign-in emails were sent". For anything beyond a single user, set a custom SMTP sender (free tiers: Resend, Brevo) under _SMTP Settings_.
   - **Speed.** `apps/web/vercel.json` pins Vercel functions to `bom1` (Mumbai), beside the database; the default `iad1` (US East) added a trans-Pacific round trip to every server-side API call. `.github/workflows/keep-api-warm.yml` was meant to keep the API awake, but GitHub fires free scheduled jobs best-effort (4 runs in 12 hours instead of 72), so the API now pings its own public `/health` every 10 minutes (`KeepAwakeService`, on whenever Render sets `RENDER_EXTERNAL_URL`); the workflow remains as a backup (D92, D94). The worker workflow is subject to the same delays — it runs every few hours, not every 30 minutes. For punctual ticks, set `WORKER_DISPATCH_TOKEN` on the API: it then starts the worker every 30 minutes itself through GitHub's `workflow_dispatch` (D95). Create the token at GitHub → Settings → Developer settings → Fine-grained tokens, with access to this repository only and the single permission **Actions: Read and write**, and paste it into Render's Environment page — it never needs to be anywhere else. **Region:** the API must run in Render's _Singapore_ region, next to the Mumbai database — every request makes several sequential queries, and from Oregon each crossed the Pacific (~0.25 s), so every page waited 2-3 s on the API (D97). The live service is `jobsentinel-api-sg` (`https://jobsentinel-api-sg.onrender.com`). A Render service's region cannot be changed: moving it means creating a new service in the target region, pasting its secrets into its Environment page, setting the health check to `/health/ready`, then updating `NEXT_PUBLIC_API_BASE_URL` (Vercel, then redeploy — it is baked in at build time) and the keep-warm URL, and deleting the old service so only one API dispatches the worker and spends free hours.
4. **Worker.** Same image or repo, `node dist/worker.js`. In production keep `TELEGRAM_POLLING=false`: the API receives bot updates by webhook (D98), and Telegram refuses `getUpdates` while a webhook is set (a local polling worker just logs that and stands down). Polling (`TELEGRAM_MODE=polling`, `TELEGRAM_POLLING=true` on exactly one process) remains for local development with no public URL.
5. **Set `APP_BASE_URL` and `WEB_ORIGIN`** to the real web URL on the API (`WEB_ORIGIN` is the CORS origin; left at localhost, every browser call from the deployed site fails). Telegram rejects inline buttons pointing at `localhost`, so alerts lose their "View" button until this is a public URL (D56).

## Environment

`packages/config/src/env.ts` is the single source of truth: it validates at boot and refuses to start on a bad value rather than failing later. `.env.example` lists every variable. `pnpm env:sync` copies the root `.env` into `apps/api/.env` and the public subset into `apps/web/.env.local` — run it after editing secrets, or the API will read a stale file.

Never commit `.env`. The pre-commit hook blocks it and scans staged diffs for key-shaped strings.

## Operating

```bash
pnpm --filter @jobsentinel/api worker -- --once     # one full tick
pnpm --filter @jobsentinel/api classify [--requeue] # re-run classification
pnpm --filter @jobsentinel/api validate [--recheck] # drain / re-check validation
pnpm --filter @jobsentinel/api match --ai=12        # score against profiles
pnpm --filter @jobsentinel/api notify [--digest]    # decide + deliver alerts
pnpm --filter @jobsentinel/api clean:test [--dry]   # remove fixtures from a killed test run
```

Every one is idempotent. Re-running never duplicates a job, a match or an alert — the database's unique keys are what guarantee that, not the scripts.

## Backups

`scripts/backup.sh` runs `pg_dump` against the session pooler and keeps the last 8 weekly dumps. Restore is a plain `psql < dump.sql` into a fresh project; rehearse it before you need it. Supabase's own free-tier backups are not a substitute — they are not restorable to a point in time on the free plan.

## Health and alerting

- `GET /health` — liveness, no dependencies.
- `GET /health/ready` — readiness: database reachable, migrations present.
- `GET /api/v1/system/status` — worker heartbeat, source health, pipeline counts, today's AI usage against both budgets.
- The worker raises Telegram system alerts (rate-limited to one per type per 6 h) for a disabled source, a long gap since the last successful scan, and an exhausted AI budget.

Point UptimeRobot at `/health/ready` every 5 minutes. On Render's free tier this also keeps the API awake.

## Free-tier limits worth respecting

| Service    | Limit that actually bites                | What the code does about it                                     |
| ---------- | ---------------------------------------- | --------------------------------------------------------------- |
| Gemini     | **15 requests/minute**, not just per day | `AI_MIN_REQUEST_GAP_MS` paces calls; 429 `retry in Ns` honoured |
| Supabase   | pooler connection slots                  | `max: 8` in production, `statement_timeout` 60 s                |
| Render     | sleeps without traffic                   | worker hosted elsewhere; uptime ping on `/health/ready`         |
| Telegram   | ~30 messages/second                      | dispatcher paces to 1/second                                    |
| Job boards | politeness and 403/429                   | one `HttpClient`, per-host gaps, back off and disable on blocks |

Re-check these terms before you rely on them; free tiers change, and the worker is portable by design.
