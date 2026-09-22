# 15 — Claude / Gemini Responsibility Split (Antigravity workspace)

## 1. Ownership map

| Area                                                                                 | Owner               | Reviewer          | Paths                                                            |
| ------------------------------------------------------------------------------------ | ------------------- | ----------------- | ---------------------------------------------------------------- |
| Architecture, AGENTS.md, docs                                                        | **Claude**          | user              | `docs/**`, `AGENTS.md`, `README.md`                              |
| Monorepo tooling, CI, lint/format config                                             | Claude              | —                 | root configs, `.github/**`, `scripts/**`                         |
| Shared types & Zod schemas                                                           | Claude              | Gemini (consumer) | `packages/types/**`                                              |
| Validation rules, AI package, config/taxonomy                                        | Claude              | —                 | `packages/validation/**`, `packages/ai/**`, `packages/config/**` |
| NestJS API + worker, DB schema/migrations/seed                                       | Claude              | —                 | `apps/api/**`                                                    |
| Security, testing strategy, integration, refactoring                                 | Claude              | —                 | cross-cutting                                                    |
| Next.js app: pages, components, hooks, styling, responsiveness, a11y, PWA, dark mode | **Gemini**          | Claude            | `apps/web/**`                                                    |
| Typed API client & query hooks                                                       | Gemini (implements) | Claude (contract) | `apps/web/lib/api.ts`, `apps/web/hooks/**`                       |
| Web tests (Vitest, Playwright)                                                       | Gemini              | Claude            | `apps/web/**/*.test.tsx`, `apps/web/e2e/**`                      |

## 2. Coordination protocol

1. **Read `AGENTS.md` before any edit.** It restates this table and the conventions.
2. **Contract-first.** Claude publishes/changes API DTOs in `packages/types` and doc 03 _before_ Gemini builds against them. Gemini never invents fields; if the UI needs data the API doesn't provide, Gemini opens a note in `docs/requests/frontend-needs.md` (or the chat) and Claude extends the contract.
3. **Cross-boundary edits require a flag.** If Gemini must touch anything outside `apps/web`, or Claude anything inside `apps/web` (e.g. wiring auth middleware), the agent says so explicitly, keeps the change minimal, and the owner reviews it.
4. **No parallel edits to the same file.** Shared files (`.env.example`, `README.md`, `package.json` at root, `pnpm-workspace.yaml`) are Claude-owned; Gemini requests changes.
5. **Phase gates.** Phases 8 and 11 (frontend) are Gemini's; Claude reviews against doc 04 §4 acceptance criteria and the API contract, runs the web tests, and signs off. Backend phases are Claude's; Gemini may consume only merged, documented endpoints.
6. **Mock mode for parallel work.** `apps/web` supports `NEXT_PUBLIC_API_MOCK=true` (MSW handlers generated from the Zod schemas) so Gemini can build UI before the backend phase lands. Mocks are removed from production builds.
7. **Commit discipline.** Conventional commits with scope (`feat(web): …`, `feat(api): …`, `docs: …`); one agent per commit; every commit references its phase (`[P8]`).
8. **Review checklist for Gemini's work (Claude):** types from `packages/types` only; no secrets; no business logic in the browser; responsive at 360/768/1280; loading/error/empty states; a11y basics; tests present.

## 3. What each agent must never do

- Gemini: modify DB schema, API, validation rules, AI prompts, env schema; add npm deps to the API; bypass the API by querying Supabase tables directly.
- Claude: restyle or restructure UI components without coordinating; change UX flows Gemini owns without noting it.
