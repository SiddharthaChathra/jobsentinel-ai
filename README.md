# JobSentinel AI

Personal AI-powered job **discovery → verification → matching → notification** system for fresher/entry-level engineering roles. It monitors permitted public job sources, verifies that companies, listings and application links are genuine and active, scores each job against your resume, and alerts you on Telegram and a responsive web dashboard — for ₹0/month.

> Status: **running end to end.** Phases 0–9 and 11 are complete: 2,600+ real postings ingested
> from 32 live sources, classified, validated with evidence, scored against a resume profile, and
> delivered as real Telegram alerts with working APPLY buttons. Phase 12 (production deployment)
> is in progress. See [STATUS.md](STATUS.md) for the live picture, [CHANGELOG.md](CHANGELOG.md)
> for what landed per phase, and [docs/architecture/16-roadmap.md](docs/architecture/16-roadmap.md)
> for the plan.

## What it does

- Scans company ATS boards (Greenhouse, Lever, Ashby, …), RSS feeds and free public job APIs on a smart schedule — never bypassing CAPTCHAs, logins, robots rules or rate limits.
- Normalizes and de-duplicates listings across sources.
- Detects fresher/entry-level eligibility with rules **and** AI (never keywords alone).
- Validates company, application URL, job availability and scam indicators with evidence-based confidence (AI is never the sole judge).
- Matches jobs to your resume profile with an explanation ("✓ Python ✓ SQL ✓ Linux · ✗ Kubernetes") and priority bands.
- Sends instant Telegram alerts with a direct **APPLY NOW** button, plus a daily digest.
- Tracks saved/applied jobs; works on laptop and phone.

## Stack

Next.js 16 · Tailwind v4 · shadcn/ui · NestJS 11 · TypeScript · Zod · Drizzle · Supabase (Postgres/Auth/Storage) · pnpm workspaces · Jest/Vitest/Playwright · Telegram Bot API · Gemini/Claude/local AI adapters.

## Repository layout

```
apps/web         Next.js dashboard
apps/api         NestJS REST API (src/main.ts) + background worker (src/worker.ts)
packages/types   Shared Zod schemas, enums, API DTOs
packages/validation  Pure deterministic rules (fresher, scam indicators, normalization)
packages/ai      Provider-independent AI service
packages/config  Typed env schema + taxonomy/constants
docs/            Architecture package (start at docs/README.md)
```

## Getting started

Prerequisites: Node ≥ 22, pnpm ≥ 9 (`npm i -g pnpm`), a free [Supabase](https://supabase.com) project (needed from Phase 2).

```bash
pnpm install
cp .env.example .env            # fill in values as phases require them
pnpm build                      # builds packages, api, web
pnpm dev:api                    # http://localhost:4000/health
pnpm dev:web                    # http://localhost:3000
pnpm --filter @jobsentinel/api worker -- --once   # one worker tick
```

Quality gates: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build`.

## Documentation

- [docs/README.md](docs/README.md) — index of the architecture package (decisions, database, API contract, sources, scheduler, validation, AI, notifications, security, testing, deployment, roadmap, risks).
- [AGENTS.md](AGENTS.md) — rules both AI agents (Claude, Gemini) follow when editing this repo.
- Long-lived operational pages: [database](docs/database.md) · [sources](docs/sources.md) ·
  [matching](docs/matching.md) · [notifications](docs/notifications.md) ·
  [deployment and runbook](docs/deployment.md).

## Monthly cost

| Service                    | Tier                                                  | Cost |
| -------------------------- | ----------------------------------------------------- | ---- |
| Vercel (web)               | Hobby                                                 | ₹0   |
| Supabase (DB/Auth/Storage) | Free                                                  | ₹0   |
| Render (API)               | Free web service                                      | ₹0   |
| Worker host                | Oracle Always Free / own laptop / GitHub Actions cron | ₹0   |
| Gemini API                 | Free tier                                             | ₹0   |
| Telegram Bot API           | Free                                                  | ₹0   |

Tier terms verified 2026-09-22; re-check before deploying (docs/architecture/14).

The limit that actually bites is Gemini free tier's **15 requests per minute** — not the daily
cap. The AI layer paces itself under it and honours the provider's retry hints; see
[docs/deployment.md](docs/deployment.md).

## Principles

Reliability over flashy AI · deterministic where possible, AI where semantics matter · explainable results · respect every site's terms · privacy of resume data · provider independence · mobile + laptop friendly.
