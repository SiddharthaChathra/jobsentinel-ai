# Changelog

All notable changes, grouped by roadmap phase (docs/architecture/16-roadmap.md).

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
