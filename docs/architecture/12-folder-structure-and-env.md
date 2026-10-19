# 12 — Folder Structure & Environment Variables

## 1. Monorepo layout (pnpm workspaces)

```
jobsentinel-ai/
├── apps/
│   ├── web/                          # Next.js (Gemini)
│   │   ├── app/                      # routes (doc 04 §2)
│   │   ├── components/               # ui/, layout/, jobs/, dashboard/, onboarding/, preferences/, system/, common/
│   │   ├── hooks/
│   │   ├── lib/                      # api.ts, supabase/, format.ts, queryKeys.ts, constants.ts
│   │   ├── public/                   # icons, manifest
│   │   ├── proxy.ts                  # Next 16 (was middleware.ts)
│   │   ├── next.config.ts, tailwind.config.ts, components.json (shadcn)
│   │   ├── vitest.config.ts, playwright.config.ts
│   │   └── package.json
│   └── api/                          # NestJS (Claude): API + worker
│       ├── src/
│       │   ├── main.ts, worker.ts, app.module.ts, worker.module.ts
│       │   ├── common/  auth/  users/  resumes/  jobs/  sources/  scheduler/  validation/  matching/  notifications/  system/
│       │   └── common/db/{schema/,migrations/,seed/}
│       ├── test/                     # e2e (supertest) + fixtures/ (recorded source payloads, sample JDs)
│       ├── Dockerfile                # multi-stage; CMD selectable: api | worker | worker --once
│       ├── drizzle.config.ts, jest.config.ts, nest-cli.json
│       └── package.json
├── packages/
│   ├── types/      src/{enums.ts, domain/*.ts, api/*.ts, index.ts}          # Zod + inferred types
│   ├── validation/ src/{fresher.ts, suspicion.ts, domain.ts, dedupe.ts, normalize/*.ts, salary.ts, category.ts}
│   ├── ai/         src/{ai-service.ts, provider.ts, adapters/{gemini,claude,local}.ts, prompts/*.v1.ts, schemas/*.ts, budget.ts, json-repair.ts}
│   └── config/     src/{env.ts, taxonomy/{roles.ts, categories.ts, ats-domains.ts, indicators.ts, salary-bands.ts}, intervals.ts}
├── docs/
│   ├── architecture.md  database.md  ai.md  sources.md  deployment.md   # long-lived (derived from this package in Phase 1)
│   └── architecture/                                                  # this Phase 0 package
├── scripts/            # db:migrate, db:seed, backup.sh, add-source.ts
├── .github/workflows/  # ci.yml (lint, typecheck, test), worker-once.yml (optional cron fallback)
├── AGENTS.md  README.md  .env.example  pnpm-workspace.yaml  package.json  tsconfig.base.json
├── .eslintrc.cjs  .prettierrc  .gitignore  .gitleaks.toml  .nvmrc (Node 22 LTS)
└── docker-compose.yml  # local Postgres for tests (optional; Supabase CLI alternative)
```

Ownership boundaries (enforced by review, see doc 15): Gemini edits only `apps/web/**` (except `apps/web/lib/api.ts` types which follow `packages/types`); Claude edits everything else. Shared touchpoints (`packages/types`, `.env.example`, `README.md`) are Claude-owned; Gemini requests changes.

## 2. Environment variables (`.env.example`)

```bash
# ───────── Shared ─────────
NODE_ENV=development
APP_BASE_URL=http://localhost:3000            # web origin (CORS, deep links)
API_BASE_URL=http://localhost:4000

# ───────── Supabase ─────────
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=...                         # web (as NEXT_PUBLIC_) + api
SUPABASE_SERVICE_ROLE_KEY=...                 # api + worker ONLY
SUPABASE_JWT_ISSUER=https://xxxx.supabase.co/auth/v1
DATABASE_URL=postgresql://postgres.[ref]:[pw]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres   # pooled (API)
DATABASE_DIRECT_URL=postgresql://...:5432/postgres                                                 # migrations
RESUME_BUCKET=resumes

# ───────── Web (public) ─────────
NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
NEXT_PUBLIC_API_BASE_URL=${API_BASE_URL}
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=JobSentinelBot

# ───────── API ─────────
PORT=4000
RENDER_EXTERNAL_URL=                          # set by Render automatically; enables the API's keep-awake ping (D94)
AUTO_PAUSE_ENABLED=true                       # false: log would-pause decisions, pause nothing (D104)
# Mark talent-pool / general-application postings PLACEHOLDER (D117); off until confirmed
PLACEHOLDER_FILTER_ENABLED=false
AUTO_PAUSE_MIN_COLLECTED=20                   # source auto-pause: min jobs collected with none kept (D104)
AUTO_PAUSE_WINDOW_DAYS=30                     # ...over this many days; India-scoped sources alert instead
KEEP_AWAKE_HOURS=0-24                         # local hours the API keeps itself awake on Render, e.g. 7-24 (D99)
KEEP_AWAKE_TZ=Asia/Kolkata
WORKER_DISPATCH_TOKEN=                        # optional: GitHub fine-grained token (Actions read+write, this repo only); API then starts the worker on time (D95)
WORKER_DISPATCH_REPO=SiddharthaChathra/jobsentinel-ai
WORKER_DISPATCH_INTERVAL_MIN=30
WEB_ORIGIN=http://localhost:3000   # CORS: comma-separated origins, e.g. https://jobsentinel-ai.vercel.app,http://localhost:3000
ALLOWED_SIGNUP_EMAILS=*                       # * = anyone may sign up, or a comma list to restrict
ADMIN_EMAILS=you@example.com
ENABLE_API_DOCS=true
LOG_LEVEL=info
RATE_LIMIT_PER_MIN=120

# ───────── Worker ─────────
WORKER_TICK_MS=60000
WORKER_MAX_SOURCES_PER_TICK=3
WORKER_SOURCE_CONCURRENCY=2
SOURCE_SCAN_TIMEOUT_MS=120000
HTTP_USER_AGENT="JobSentinelAI/1.0 (+mailto:you@example.com)"
HTTP_TIMEOUT_MS=15000
WORKER_HEALTH_PORT=                            # optional tiny /healthz
TELEGRAM_POLLING=true

# ───────── AI ─────────
AI_PROVIDER=gemini                             # gemini | claude | local
AI_FALLBACK_PROVIDERS=                         # e.g. claude
AI_GEMINI_API_KEY=
AI_GEMINI_MODEL=gemini-3.5-flash-lite
AI_CLAUDE_API_KEY=
AI_CLAUDE_MODEL=claude-haiku-4-5
AI_LOCAL_BASE_URL=http://localhost:11434
AI_LOCAL_MODEL=llama3.1
AI_DAILY_CALL_BUDGET=500
AI_DAILY_TOKEN_BUDGET=1500000
# AI calls per user per day for their matches (resume parsing is capped separately, D93/D112)
AI_USER_DAILY_CALL_LIMIT=100
AI_ALLOW_DETERMINISTIC_ALERTS=true

# ───────── Notifications ─────────
TELEGRAM_BOT_TOKEN=
TELEGRAM_MODE=polling                          # polling | webhook
TELEGRAM_WEBHOOK_SECRET=                      # optional; derived from the bot token when empty (D98)

# ───────── Sources (optional keys) ─────────
ADZUNA_APP_ID=
ADZUNA_APP_KEY=
ADZUNA_LIMIT_PER_MINUTE=25                    # Adzuna's published quota (terms, 2026-10-17); scans stop before it (D108)
ADZUNA_LIMIT_PER_DAY=250
ADZUNA_LIMIT_PER_WEEK=1000
ADZUNA_LIMIT_PER_MONTH=2500
SOURCE_QUOTA_SAFETY=0.9                       # use at most this share of any quota window

# ───────── Tests ─────────
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:44322/postgres
# Local test stack ports (scripts/test-env.mjs only, not read by the app): default 44320-44329 from
# supabase/config.toml, below Windows' dynamic range; set a base to move them, e.g. 45320 →
# API 45321, database 45322.
# TEST_STACK_PORT_BASE=44320
AI_LIVE_TESTS=0
# Tests only (read by the test guard, never by the app; D101). apps/api/.env.test is generated
# by `pnpm test:db:start`. Tests abort on PRODUCTION_SUPABASE_REF and accept a hosted
# database only if it is TEST_SUPABASE_REF. Project refs are identifiers, not secrets.
PRODUCTION_SUPABASE_REF=
TEST_SUPABASE_REF=
```

Rules: `packages/config/env.ts` declares each variable with a Zod type, default and which process needs it (`web | api | worker`); boot fails with a list of missing variables. Vercel gets only `NEXT_PUBLIC_*`; Render/VM get API+worker sets; GitHub Actions cron (if used) gets worker set as repository secrets.
