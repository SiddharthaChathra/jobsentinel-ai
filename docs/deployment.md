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
   - **Speed.** `apps/web/vercel.json` pins Vercel functions to `bom1` (Mumbai), beside the database; the default `iad1` (US East) added a trans-Pacific round trip to every server-side API call. `.github/workflows/keep-api-warm.yml` was meant to keep the API awake, but GitHub fires free scheduled jobs best-effort (4 runs in 12 hours instead of 72), so the API now pings its own public `/health` every 10 minutes (`KeepAwakeService`, on whenever Render sets `RENDER_EXTERNAL_URL`); the workflow remains as a backup (D92, D94). Every free Render service in a workspace shares 750 hours a month and an always-awake API uses ~744, so production sets `KEEP_AWAKE_HOURS=7-24` (India time): the API sleeps overnight, leaving ~220 hours for another free service, and the first request after midnight waits 30-60 s while it wakes. The keep-warm workflow runs on the same hours and is what wakes the API at 07:00 (D99). The worker workflow is subject to the same delays — it runs every few hours, not every 30 minutes. For punctual ticks, set `WORKER_DISPATCH_TOKEN` on the API: it then starts the worker every 30 minutes itself through GitHub's `workflow_dispatch` (D95). Create the token at GitHub → Settings → Developer settings → Fine-grained tokens, with access to this repository only and the single permission **Actions: Read and write**, and paste it into Render's Environment page — it never needs to be anywhere else. **Region:** the API must run in Render's _Singapore_ region, next to the Mumbai database — every request makes several sequential queries, and from Oregon each crossed the Pacific (~0.25 s), so every page waited 2-3 s on the API (D97). The live service is `jobsentinel-api-sg` (`https://jobsentinel-api-sg.onrender.com`). A Render service's region cannot be changed: moving it means creating a new service in the target region, pasting its secrets into its Environment page, setting the health check to `/health/ready`, then updating `NEXT_PUBLIC_API_BASE_URL` (Vercel, then redeploy — it is baked in at build time) and the keep-warm URL, and deleting the old service so only one API dispatches the worker and spends free hours.
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

### Placeholder filter: rollback

The placeholder filter (D117) was switched on 2026-10-18, and the 15 existing talent-pool postings were marked `PLACEHOLDER`. Each one's `PLACEHOLDER` job event records its previous status and hold reason. To undo:

1. **Turn the flag off.** Set `PLACEHOLDER_FILTER_ENABLED: 'false'` in `.github/workflows/worker.yml` (the worker's env block), commit and push to `main`. Do this first, or the next tick marks the jobs again. If the worker runs elsewhere (a VM or laptop), set the variable to `false` there too.
2. **Preview.** `pnpm --filter @jobsentinel/api build && node apps/api/dist/scripts/placeholders.js --restore --dry-run` lists every `PLACEHOLDER` job and the status it will return to.
3. **Restore.** Run the same command without `--dry-run`:
   - A job marked by the backfill goes back to its recorded status and hold reason.
   - A job the classifier marked while the flag was on has no earlier status. It goes back to `DISCOVERED` and is re-classified on the next tick, as if the filter had never existed.
   - Each restore writes a `PLACEHOLDER_RESTORED` event.
4. **Check.** `select status, count(*) from jobs group by status` should show no `PLACEHOLDER` rows. Restored jobs reappear on the report card under collected.

The rollback deletes nothing. The `PLACEHOLDER` value stays in the `job_status` enum, because Postgres cannot drop an enum value, and that is harmless.

## Backups

**Weekly, encrypted (F10, D123).** `.github/workflows/backup.yml` runs every Sunday at 20:30 UTC (Monday 02:00 IST), and on demand (Actions → "Weekly encrypted backup" → Run workflow).

What the workflow does:

- Installs `pg_dump` 17 (it must match the server's major version) and runs `scripts/backup.sh` with `REQUIRE_ENCRYPTION=1`.
- The script streams `pg_dump | gzip | age` straight into a `.sql.gz.age` file, so the plain dump never touches the disk. Without a key it refuses to run.
- A check step proves the result is a single file with the age header and no SQL in clear text.
- The file is kept only as a workflow artifact for 90 days, GitHub's maximum for this repository.

**What is in it:**

- the `public` and `drizzle` schemas: every table, its data, RLS policies, and the migration ledger;
- the rows of `auth.users` and `auth.identities`, so restored users can still sign in;
- a `CREATE EXTENSION pg_trgm` line, for the trigram indexes.

**What is NOT in it: Supabase Storage files**, i.e. uploaded resumes. They live in the private `resumes` bucket, not in Postgres, so `pg_dump` cannot see them.

- After a restore, `resumes` rows point at files that may no longer exist.
- The parsed profile (skills, summary) is in Postgres and survives; the original PDF does not.
- Users can re-upload. If keeping the files matters, download the bucket from the Supabase dashboard (Storage → resumes) when you need a copy. This is a documented limitation, not automated.

**One-time setup (you; secrets never pass through chat):**

1. On your own machine: `age-keygen -o jobsentinel-backup.key`. It prints the public key (`age1…`). Keep the `.key` file **offline** (a USB drive or password manager). Without it, no backup can be decrypted; with it, every backup can.
2. GitHub → repository Settings → Secrets and variables → Actions → New repository secret:
   - `BACKUP_AGE_RECIPIENT`: the `age1…` public key.
   - `BACKUP_DATABASE_URL`: the Supabase **session pooler** connection string (port 5432; the same as `DATABASE_DIRECT_URL` in your `.env`). The transaction pooler (6543) cannot run `pg_dump`.
3. Actions → "Weekly encrypted backup" → Run workflow. Check that the run is green and the artifact ends in `.sql.gz.age`.

The repository is **public**: anyone signed in to GitHub can download the artifact. That is safe only because it is encrypted to a key that never leaves your hands. Never upload the private key anywhere, and never add a step that writes the dump unencrypted.

**Restore** (rehearsed 2026-10-18 against the local test stack: 29 tables, identical row counts):

1. Download the artifact (Actions → the run → Artifacts) and unzip it to get `jobsentinel-<stamp>.sql.gz.age`.
2. Pick the target: a new Supabase project, or the test project to rehearse. Never restore over production without a fresh backup of it first.
3. `age -d -i jobsentinel-backup.key jobsentinel-<stamp>.sql.gz.age | gunzip -c | psql "<target session URL>"`
   - `ERROR: schema "public" already exists` is expected and harmless.
   - Any other error means stop and look.
4. Point `.env` at the target and run `pnpm db:migrate`. It should report nothing to apply, because the ledger was restored.
5. Re-create the `resumes` Storage bucket (private) if the target is a new project. The files themselves are not in the backup (see above).
6. Check row counts on a few tables (`jobs`, `users`, `applications`) against what you expect.

The local rehearsal is `postgres:17-alpine` with `age`, running the real script against the test stack and restoring into a fresh database. A bare database needs the `auth` schema's two tables and an `auth.uid()` stub before loading; a real Supabase project already has them.

Supabase's own free-tier backups are not a substitute: on the free plan they cannot be restored to a point in time.

## Health and alerting

- `GET /health` — liveness, no dependencies.
- `GET /health/ready` — readiness: database reachable, migrations present.
- `GET /health/worker` — the worker is alive (F11, D124). The response is `{ status, lastBeatAt, ageMin, thresholdMin, activeHours }`.
  - **503 `unhealthy`** when the last heartbeat is older than 2× `WORKER_DISPATCH_INTERVAL_MIN` (2 × 30 = 60 minutes).
  - The check applies only inside `KEEP_AWAKE_HOURS` (production `7-24` IST), measured from when that window opened if that is later than the last beat.
  - Outside the window it answers 200 `outside_active_hours`. The API sleeps then (D99) and dispatches no worker runs, so a gap is expected, not an outage.
- `GET /api/v1/system/status` — worker heartbeat, source health, pipeline counts, today's AI usage against both budgets.
- The worker raises Telegram system alerts (rate-limited to one per type per 6 h) for a disabled source, a long gap since the last successful scan, and an exhausted AI budget.

**Uptime alerts (F11, D124): `.github/workflows/uptime.yml`.** Every 15 minutes from 07:30 to 00:15 IST, it runs `scripts/uptime-check.mjs` against `/health/ready` and `/health/worker`:

- It allows up to 90 seconds, twice, for a cold start.
- It sends you a Telegram message when either goes down and once when both recover, never once per run. The previous run's result is the last known state, so a red run means "down".
- Rehearsed locally on 2026-10-18 against the real API and a stub Telegram: a stale worker sent one "down"; staying down sent nothing; a fresh heartbeat sent one "recovered"; healthy sent nothing; a stopped API sent "down". The token never appears in the output.

Setup (you; secrets never pass through chat):

1. Find your chat id: send any message to your bot, then open `https://api.telegram.org/bot<token>/getUpdates` in your own browser and read `message.chat.id`. Or use the id JobSentinel already stores for you in `telegram_links`.
2. GitHub → Settings → Secrets and variables → Actions → New repository secret: `ALERT_TELEGRAM_CHAT_ID` = that id. `TELEGRAM_BOT_TOKEN` is already set for the worker.
3. Actions → uptime → Run workflow, and check the run is green. To see an alert, stop the worker or wait for a real outage. Don't fake one in production.

**Why not UptimeRobot.** Checked 2026-10-18 on uptimerobot.com/pricing and the help center:

- **The free plan:** 50 monitors, checks every 5 minutes, keyword monitors. Its alert integrations are Google Chat, Discord, Pushover, Pushbullet and Splunk. **Telegram needs the paid Solo plan, and webhooks the Team plan.**
- **The bigger problem:** a check every 5 minutes, 24 hours a day, keeps the free Render API awake all night. That uses about 744 of the workspace's 750 free hours and suspends your other free service (D99). No free-plan maintenance window could be confirmed to prevent it.

If you still want it (for example, e-mail alerts as a second channel), add an HTTP(S) keyword monitor on `/health/worker` with keyword `"ok"`, and pause it overnight by hand. Re-check the plan's terms first: they change.

GitHub runs scheduled jobs best-effort, so a check can run late or be skipped. This is a safety net, not a pager.

## Free-tier limits worth respecting

| Service    | Limit that actually bites                | What the code does about it                                     |
| ---------- | ---------------------------------------- | --------------------------------------------------------------- |
| Gemini     | **15 requests/minute**, not just per day | `AI_MIN_REQUEST_GAP_MS` paces calls; 429 `retry in Ns` honoured |
| Supabase   | pooler connection slots                  | `max: 8` in production, `statement_timeout` 60 s                |
| Render     | sleeps without traffic                   | worker hosted elsewhere; uptime ping on `/health/ready`         |
| Telegram   | ~30 messages/second                      | dispatcher paces to 1/second                                    |
| Job boards | politeness and 403/429                   | one `HttpClient`, per-host gaps, back off and disable on blocks |

Re-check these terms before you rely on them; free tiers change, and the worker is portable by design.
