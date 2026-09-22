# 17 — Risks, Limitations & Recommended MVP Scope

## 1. Risks and mitigations

| #   | Risk                                                                                                                    | Likelihood / impact | Mitigation                                                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Coverage gap**: the big Indian fresher volume lives on LinkedIn/Naukri/Indeed, which are out of scope (ToS/anti-bot). | High / High         | ATS APIs cover most product companies' own postings (the source of truth); Adzuna adds aggregator breadth legitimately; user maintains a company watchlist; be explicit in README that this is a _targeted_ monitor, not a Naukri replacement. |
| R2  | Free hosts sleep or throttle the worker → delayed discovery.                                                            | Medium / Medium     | `--once` portability; recovery scanning; multiple host options; discovery latency is tracked and shown.                                                                                                                                        |
| R3  | Supabase free project pauses after inactivity; free-tier terms change.                                                  | Low / High          | worker activity prevents pause; plain Postgres schema + weekly dumps make migration to Neon/self-host a config change.                                                                                                                         |
| R4  | Gemini free-tier limits or data-use terms unacceptable.                                                                 | Medium / Medium     | provider abstraction; budgets; Claude/local fallback; deterministic paths keep the system useful with AI off.                                                                                                                                  |
| R5  | False "VALID" on a well-crafted scam with a real-looking domain.                                                        | Low / High          | evidence weights favour structural signals (own ATS board, domain relationship); unknown domains → NEEDS_REVIEW; scam patterns tuned with fixtures; UI always shows evidence so the user decides; "never claim certainty" wording.             |
| R6  | False "EXPIRED"/"SUSPICIOUS" hides good jobs.                                                                           | Medium / Medium     | expired requires URL evidence + disappearance; review tab; score never deletes; re-validate button.                                                                                                                                            |
| R7  | Fresher misclassification (ambiguous JDs).                                                                              | Medium / Medium     | rules + AI + UNKNOWN kept visible with badge; fixture agreement target ≥ 90 %.                                                                                                                                                                 |
| R8  | Source APIs change shape.                                                                                               | Medium / Low        | Zod-validated adapter outputs; per-source isolation; System Status surfaces failures; recorded fixtures make fixes quick.                                                                                                                      |
| R9  | A source's terms forbid automated access even for a public endpoint.                                                    | Low / Medium        | each adapter documents its access basis; `career_page` adapter checks robots.txt every 24 h; user can disable any source; we never evade blocks.                                                                                               |
| R10 | Two agents overwrite each other's work.                                                                                 | Medium / Medium     | ownership map, AGENTS.md, contract-first, mock mode, one-agent-per-commit.                                                                                                                                                                     |
| R11 | Scope creep (dozens of sources, chat bots, auto-apply).                                                                 | High / Medium       | MVP list below; auto-apply is explicitly out (ToS + ethics + CAPTCHA).                                                                                                                                                                         |
| R12 | Resume PII sent to a third-party AI.                                                                                    | Medium / Medium     | redaction, minimal fields, provider choice, documented terms, local model path.                                                                                                                                                                |
| R13 | Dedupe misses → duplicate notifications.                                                                                | Low / Medium        | DB unique constraint is the last line; fuzzy dedupe is secondary.                                                                                                                                                                              |
| R14 | Windows dev environment quirks (paths, line endings, Playwright).                                                       | Medium / Low        | `.gitattributes` LF, `cross-env`, Docker for Postgres, documented setup.                                                                                                                                                                       |

## 2. Known limitations (documented, not hidden)

- Not a scraper of major job boards; coverage = configured companies + feeds + Adzuna.
- Company legitimacy is probabilistic; no paid registry checks.
- Scanned-image resumes unsupported in MVP.
- Discovery latency depends on where the worker runs (10 min on a VM; up to ~30–45 min via GitHub Actions cron).
- Single worker; not designed for many users.
- AI free-tier quotas may defer semantic matching to the next day; deterministic scores remain.
- No auto-apply, ever.

## 3. Recommended MVP scope (Phases 1–9, trimmed)

**In:**

- Auth (email/password + magic link), signup gate.
- Resume upload (PDF/DOCX) → AI profile draft → confirm; preferences (roles by tier, locations, remote, categories, fresher-only, instant threshold).
- Sources: Greenhouse, Lever, Ashby, RSS, Remotive (≈ 25 seeded sources), manual add from dashboard.
- Full pipeline: normalize → dedupe → classify (rules + AI for ambiguous) → validate (company/URL/availability/suspicion, AI-assisted) → match (deterministic + AI) → notify.
- Telegram instant alerts + daily digest + linking + APPLY button; web inbox.
- Dashboard: dashboard, jobs (filters/search/detail/review), saved, applications tracker, resume, preferences, system status, settings. Responsive, light/dark.
- Reliability basics: source isolation, backoff, recovery sweep, re-check for expiry, heartbeat, unique-notification guarantee.
- Deployment: Vercel + Render + worker on VM or laptop with Actions fallback; backups.

**Out of MVP (backlog):**

- `career_page` HTML adapter, SmartRecruiters/Workable/Adzuna (add once core is stable — Adzuna first, it's a key-only change).
- Google OAuth, local model adapter implementation, web push, PWA offline, kanban drag-drop, analytics charts, multi-resume comparison, salary insights, interview prep features, auto-apply (never).

## 4. Success criteria for the MVP demo

1. A new fresher posting appears on a monitored Greenhouse/Lever board → within one scan interval a Telegram alert arrives with a working APPLY button, verification badges and match explanation.
2. The same posting seen on a second source produces no second alert.
3. Killing the worker mid-scan and restarting it produces no duplicates and no lost jobs.
4. A fixture scam listing lands in SUSPICIOUS with readable evidence; a closed job lands in EXPIRED.
5. The dashboard works on an Android phone and a laptop with the same build.
6. Monthly cost: ₹0.

---

**STOP — awaiting approval.** No application code will be written until this package (or an amended version of it) is approved.
