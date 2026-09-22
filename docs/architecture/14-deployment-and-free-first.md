# 14 — Deployment & Free-First Strategy

## 1. Free-first inventory (₹0 target)

| Need                       | Choice                                                                                                                                                     | Free tier facts to verify at deploy time                                                                                                          | Swap-out if it changes                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend hosting           | **Vercel Hobby**                                                                                                                                           | non-commercial personal use, generous bandwidth                                                                                                   | Cloudflare Pages, Netlify                                                                                                                                                                                                                                                                                                                                                                                      |
| Database / Auth / Storage  | **Supabase Free**                                                                                                                                          | 500 MB DB, 1 GB storage, 50k MAU; **projects pause after ~7 days without activity** — the worker's writes keep it active; 2 free projects per org | Neon (DB) + self-hosted Supabase/GoTrue; schema is plain Postgres                                                                                                                                                                                                                                                                                                                                              |
| API hosting                | **Render Free web service**                                                                                                                                | 750 h/month, **spins down after 15 min idle** (cold start ~30–60 s); Docker or Node                                                               | Koyeb free, Fly.io (paid now), same VM as worker                                                                                                                                                                                                                                                                                                                                                               |
| Worker hosting (always-on) | **Option A: Oracle Cloud Always Free** (ARM VM, 4 OCPU/24 GB shared) running `docker compose` (api + worker)                                               | genuinely free, but sign-up capacity can be restricted by region; requires basic Linux ops                                                        | **Option B: your laptop/desktop** with Windows Task Scheduler running `pnpm worker --once` every 15 min (or the long-running loop while the machine is on). **Option C: GitHub Actions** scheduled workflow every 30 min running `worker --once` (private repo: 2,000 min/month ⇒ keep a run ≤ 1.3 min avg; Actions cron may be delayed/dropped under load — acceptable because recovery scanning covers gaps) |
| AI                         | **Gemini API free tier**                                                                                                                                   | rate/day limits sufficient for ≤ 500 calls; data-use terms of the free tier differ from paid — surfaced in Settings                               | Claude API (paid, no training on API data), local Ollama                                                                                                                                                                                                                                                                                                                                                       |
| Notifications              | **Telegram Bot API**                                                                                                                                       | free, no limits at personal scale                                                                                                                 | —                                                                                                                                                                                                                                                                                                                                                                                                              |
| Source data                | public ATS APIs, RSS, Remotive, **Adzuna** (free key, rate-limited)                                                                                        | —                                                                                                                                                 | drop Adzuna                                                                                                                                                                                                                                                                                                                                                                                                    |
| CI                         | GitHub Actions                                                                                                                                             | free for public; 2,000 min private                                                                                                                | —                                                                                                                                                                                                                                                                                                                                                                                                              |
| Monitoring                 | pino logs + System Status page + Telegram system alerts; **UptimeRobot free** pinging `/health` (also keeps Render awake within its limits — do not abuse) | —                                                                                                                                                 | Better Stack free                                                                                                                                                                                                                                                                                                                                                                                              |
| Backups                    | weekly `pg_dump` from worker to VM disk / encrypted GitHub release                                                                                         | —                                                                                                                                                 | Supabase paid PITR                                                                                                                                                                                                                                                                                                                                                                                             |
| Error tracking             | none paid; structured logs + `system_logs`; optional **Sentry free** (5k events)                                                                           | —                                                                                                                                                 | GlitchTip self-hosted                                                                                                                                                                                                                                                                                                                                                                                          |

**Design rule that makes this safe:** the worker is stateless, single-process, idempotent, and has a `--once` mode. Moving it from a VM to a laptop to GitHub Actions is only a change of _where_ the command runs. No free host is assumed to provide 24/7 execution.

## 2. Topologies

### Dev (Phase 1–10)

```
laptop: pnpm dev  →  web :3000, api :4000, worker (separate terminal)
Supabase: hosted free project (or `supabase start` locally for tests)
```

### Recommended production (personal)

```
Vercel (web) ──JWT──▶ Render free (api, Docker)  ──▶ Supabase (DB/Auth/Storage)
                       Oracle VM or laptop (worker, Docker/pnpm) ──▶ Supabase, sources, Gemini, Telegram
```

If Oracle is unavailable: run api **and** worker on the laptop when it's on (Task Scheduler at logon), with GitHub Actions `worker --once` as the safety net every 30 min. The dashboard on Vercel keeps working as long as the API is reachable; if the API is on the laptop, expose it only via the Render deployment (recommended) rather than a home-network tunnel.

### Later (if ever needed)

Single small paid VM (~₹300–400/month) running everything via docker compose. Nothing changes but env vars.

## 3. Build & run artifacts

- `apps/api/Dockerfile`: multi-stage (pnpm install → build → runtime `node:22-alpine`), `CMD ["node","dist/main.js"]`, worker uses `command: ["node","dist/worker.js"]` in compose / Render start command.
- `docker-compose.yml` (VM): `api`, `worker`, optional `postgres` for local; `restart: unless-stopped`.
- Vercel project root `apps/web`, build `pnpm --filter web build`, env `NEXT_PUBLIC_*`.
- Render: Docker deploy from repo, root `apps/api`, health check `/health/ready`, env from dashboard (never from repo).
- GitHub Actions `worker-once.yml`: `schedule: '*/30 * * * *'`, `pnpm --filter api worker --once --no-telegram`, secrets = worker env; concurrency group to avoid overlap.

## 4. Migrations & seed

- `pnpm db:generate` (drizzle-kit from schema) → SQL in `src/common/db/migrations/`; `pnpm db:migrate` runs against `DATABASE_DIRECT_URL`; executed manually before deploying API/worker (never automatically on boot in prod).
- `pnpm db:seed` — skills dictionary + starter sources (idempotent upserts).

## 5. Operations runbook (docs/deployment.md will expand)

| Task               | How                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Deploy web         | push to `main` → Vercel auto-deploy                                                                                                  |
| Deploy api         | push → Render auto-deploy (or manual)                                                                                                |
| Deploy worker (VM) | `git pull && docker compose up -d --build`                                                                                           |
| Rotate secrets     | update host env, restart; Supabase keys via dashboard                                                                                |
| Backup             | `scripts/backup.sh` (pg_dump → age-encrypt → store) weekly cron on VM                                                                |
| Restore            | `psql $DATABASE_DIRECT_URL < dump.sql` on a fresh project, then re-point env                                                         |
| Worker died?       | Telegram system alert after 6 h of no heartbeat (sent by the API's hourly check if the API is awake, otherwise visible on dashboard) |
| Supabase paused    | resume in dashboard; worker resumes automatically (DB errors are retried)                                                            |

## 6. Cost guardrails

- `AI_DAILY_CALL_BUDGET` prevents surprise usage if a paid provider is ever configured.
- No paid service can be enabled without an env var; defaults are all free options.
- README carries a "monthly cost: ₹0" table with the exact tiers relied on and the date they were verified.
