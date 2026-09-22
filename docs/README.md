# JobSentinel AI — Architecture Package (Phase 0)

**Status:** DRAFT — awaiting approval before any application code is written.
**Author:** Claude (Lead Architect). **Frontend partner:** Gemini.
**Date:** 2026-09-22

This folder is the complete Phase 0 deliverable requested by the engineering spec. Nothing here is code; every document is a design that the implementation phases (1–12) will follow. Read `00-decisions.md` first — it lists every ambiguity found in the spec and the decision taken.

| #      | Spec item                                            | Document                                                                                     |
| ------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 0      | Ambiguities, decisions, tradeoffs                    | [architecture/00-decisions.md](architecture/00-decisions.md)                                 |
| 1, 2   | Final architecture + detailed component architecture | [architecture/01-system-architecture.md](architecture/01-system-architecture.md)             |
| 3      | Database ER diagram / schema                         | [architecture/02-database.md](architecture/02-database.md)                                   |
| 4      | API contract                                         | [architecture/03-api-contract.md](architecture/03-api-contract.md)                           |
| 5      | Frontend architecture                                | [architecture/04-frontend.md](architecture/04-frontend.md)                                   |
| 6      | Backend architecture                                 | [architecture/05-backend.md](architecture/05-backend.md)                                     |
| 7      | Job-source architecture                              | [architecture/06-job-sources.md](architecture/06-job-sources.md)                             |
| 8, 9   | Scheduler + recovery architecture                    | [architecture/07-scheduler-and-recovery.md](architecture/07-scheduler-and-recovery.md)       |
| 10     | Validation architecture                              | [architecture/08-validation.md](architecture/08-validation.md)                               |
| 11     | AI architecture                                      | [architecture/09-ai.md](architecture/09-ai.md)                                               |
| 12     | Notification architecture                            | [architecture/10-notifications.md](architecture/10-notifications.md)                         |
| 13     | Security architecture                                | [architecture/11-security.md](architecture/11-security.md)                                   |
| 14, 15 | Folder structure + environment variables             | [architecture/12-folder-structure-and-env.md](architecture/12-folder-structure-and-env.md)   |
| 16     | Testing strategy                                     | [architecture/13-testing.md](architecture/13-testing.md)                                     |
| 17, 18 | Deployment + free-first strategy                     | [architecture/14-deployment-and-free-first.md](architecture/14-deployment-and-free-first.md) |
| 19     | Claude / Gemini responsibility split                 | [architecture/15-responsibility-split.md](architecture/15-responsibility-split.md)           |
| 20     | Phased implementation roadmap                        | [architecture/16-roadmap.md](architecture/16-roadmap.md)                                     |
| 21, 22 | Risks, limitations, recommended MVP scope            | [architecture/17-risks-and-mvp.md](architecture/17-risks-and-mvp.md)                         |

Long-lived operational docs: [database.md](database.md). After approval, the Phase 1 setup will move the long-lived versions of these into the `docs/` layout the spec asks for (`architecture.md`, `database.md`, `ai.md`, `sources.md`, `deployment.md`) and generate `AGENTS.md` from them.

## Non-negotiable rules carried through every document

1. No mechanism ever bypasses CAPTCHA, logins, anti-bot systems, `robots.txt`, rate limits, paywalls, or access controls. Sources that require any of those are simply not supported.
2. AI is never the sole decider for job legitimacy or fresher eligibility. Deterministic rules + evidence first, AI as an additional signal.
3. The AI layer is provider-independent (`AIService` → `GeminiAdapter` | `ClaudeAdapter` | `LocalModelAdapter`).
4. A job discovered once is never lost because a scan failed (cursor-based recovery scanning).
5. A user is never notified twice for the same canonical job (DB-enforced uniqueness).
6. Secrets stay server-side; resume data stays private and minimal when sent to AI providers.
7. ₹0 development cost; every paid dependency must have a free substitute documented.
