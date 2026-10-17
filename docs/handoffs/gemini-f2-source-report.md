# Gemini task — F2 Source report card (admin page)

You are Gemini, owner of `apps/web` in JobSentinel AI. Build the admin **Source report card** UI for feature F2. The backend, contract and sample responses already exist (Claude, decision D103). Work in a loop until every exit criterion below holds.

## 0. Read first (do not skip)

1. `AGENTS.md` — especially §4 (ownership), §5 (coding standards), §13 (testing), §14 (git).
2. `docs/architecture/03-api-contract.md` → "Sources (admin)" table and the **Source report card (F2, D103)** paragraph.
3. `packages/types/src/domain/sources.ts` → `SourceReport`, `SourceReportRow`, `SourceHealth`, `RejectReason`, `SourceReportQuery`. Import these types from `@jobsentinel/types`; never hand-write them.
4. `docs/contracts/source-report.mock.json` → sample responses for every case: all five health states, an empty report, resume, and errors 400/403/404/409.
5. The existing page `apps/web/app/(app)/system/page.tsx` and `apps/web/hooks/useSystem.ts`, which you extend.

## 1. Scope (only `apps/web/**`)

- You may edit only `apps/web/**`. You must not edit `apps/api/**`, `packages/**`, `docs/architecture/**` or root configs. If the contract seems wrong or something is missing, **stop and write the request** in your report (what field, why). Do not work around it in the UI.
- Do not query Supabase tables from the browser. All data comes from the API through `useApi()`.

## 2. What to build

**Data hooks** (in `apps/web/hooks/useSystem.ts`; add query keys in `lib/queryKeys.ts`):

- `useSourceReport(days: 7 | 30, enabled: boolean)` → `GET /sources/report?days=…`, typed `SourceReport`. It is admin-only: pass `enabled = isAdmin`, exactly like `useSources`.
- `useResumeSource()` → `POST /sources/:id/resume`. On success, invalidate the report and `queryKeys.system.sources`.

**UI** (a "Source report card" section on System Status, visible to admins only; a sub-route or tab is fine, but keep it under System Status):

- A **7 / 30 days** toggle (default 30). Remember the choice per viewer in `localStorage` (wrapped in try/catch).
- **Totals** strip: collected, kept, kept % (guard against division by zero).
- **One row or card per source:** name, adapter/type, company, and a **health badge** with a distinct style and a plain-language tooltip for each state:
  - `OK`: "Finding fresher jobs"
  - `KEPT_ZERO`: "Collects jobs, none fit"
  - `COLLECTED_NOTHING`: "Found nothing; may be broken"
  - `ERRORS`: "Failing; retrying with backoff"
  - `PAUSED`: "Auto-paused"
- Also show collected, kept, the **rejected breakdown** (only non-zero reasons, readable labels such as "Outside India", "Asks for experience", "Wrong batch", "Not engineering", "Failed validation", "Closed", "Older than 60 days", "Other"; show `PENDING` separately as "Still processing", not as a rejection), last kept date, last successful scan, and last error (truncated, full text on expand).
- **Paused sources:** show `pausedReason` and `pausedAt` prominently, plus a **Resume** button with a confirm dialog. While the request runs, disable the button and show a spinner. On success show a toast and the row turns ACTIVE.
  - 409 `SOURCE_NOT_PAUSED`: show "Already active" and refetch.
  - 404: "Source no longer exists".
  - Any other error: show the API's message.
- **Sort**, default: PAUSED, then KEPT_ZERO, then COLLECTED_NOTHING, then ERRORS, then OK; within each, collected descending. Add a simple filter by health.
- Show every date in the viewer's local time with a relative hint ("3 days ago"). `null` dates show "Never".
- **Existing source list:** `SourceStatus` now includes `PAUSED_AUTO`. Make sure the current System Status source badges render it, as "Auto-paused", not as an unknown value. Check `apps/web/lib/types/system` against `@jobsentinel/types`.

**States:** loading skeleton; empty (no sources) with a friendly message; API error with a retry button; a non-admin never sees the section and never triggers the request.

**Responsive and theme:** must work at **375px** (cards, no horizontal page scroll) and **1280px** (table or grid), in **light and dark** mode. It must be keyboard accessible (toggle, filter, resume, dialog) with visible focus and aria labels on badges and buttons.

**Stable selectors** (needed by the F9 Playwright tests; do not rename them later):

- `data-testid="source-report"`
- `source-report-days-7` and `source-report-days-30`
- `source-row-<id>`
- `source-health-<id>`
- `source-resume-<id>`
- `source-resume-confirm`
- `source-report-empty`
- `source-report-error`

## 3. Tests (Vitest + Testing Library, in `apps/web`)

Drive the tests from `docs/contracts/source-report.mock.json`: import it, and mock `useApi` and fetch. Cover:

1. Each of the 5 health states renders its badge and label.
2. The rejected breakdown hides zero reasons, and `PENDING` shows as "Still processing".
3. The 7/30 toggle changes the request's `days`.
4. Resume flow:
   - confirm, then POST, then the row becomes ACTIVE;
   - a 409 shows "Already active";
   - the button is disabled while pending.
5. Loading, empty and error (with retry) states.
6. A non-admin renders nothing and makes no request.
7. A `PAUSED_AUTO` source in the existing list shows "Auto-paused".

## 4. The loop (repeat for each sub-step until everything passes)

**PLAN → IMPLEMENT → RUN → TEST → DEBUG → VERIFY → DOCUMENT → COMMIT**

- **PLAN:** list the files you will touch. Flag any file outside `apps/web` and stop.
- **RUN:** start the API in one terminal (`pnpm dev:api`) and the web app in another (`pnpm dev:web`). Use the real endpoint against a local or dev API if available; otherwise use the mock.
- **TEST:** run these from the repo root, and all must pass with **zero warnings**:
  ```
  pnpm --filter @jobsentinel/web lint
  pnpm --filter @jobsentinel/web typecheck
  pnpm --filter @jobsentinel/web test
  pnpm --filter @jobsentinel/web build
  pnpm format:check
  ```
- **VERIFY:**
  - Check 375px and 1280px, light and dark, loading, empty and error states, an admin and a non-admin. Take screenshots of each.
  - Confirm no other page regressed: Dashboard, Jobs (filters), Applications (tracker), Preferences, Settings and System Status still load and behave as before.
- **DOCUMENT:** add a short entry to `CHANGELOG.md` under the existing "F2 — Source report card" heading. That is a shared file, so append only.
- **COMMIT:** use branch `phase-13-source-report-ui` with commits like `feat(web): [P13] source report card (F2)`. One agent per commit. Never commit `.env*`, `.next/` or `dist/`. Do not merge into `main`; Claude reviews first.

## 5. Exit criteria (all required, or report what is missing)

- Every item in §2 works against `source-report.mock.json` and against the real API.
- All §3 tests pass. lint, typecheck, test, build and format:check are green, with zero warnings.
- Checked at 375px and 1280px, in light and dark mode, in all states. No console errors.
- No edits outside `apps/web/**`, except the append to `CHANGELOG.md`.
- **Final report:**
  - files changed;
  - test totals before and after;
  - screenshots or descriptions per breakpoint and theme;
  - anything you could not verify, marked **NOT VERIFIED** with the reason;
  - any contract change you need from Claude.
