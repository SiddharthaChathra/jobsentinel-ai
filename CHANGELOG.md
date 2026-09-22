# Changelog

All notable changes, grouped by roadmap phase (docs/architecture/16-roadmap.md).

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
