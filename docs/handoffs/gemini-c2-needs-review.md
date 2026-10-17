# Gemini task — C step 2: "Needs review" view

You are Gemini, owner of `apps/web` in JobSentinel AI. Build a separate **Needs review** view for held jobs. The backend, contract and sample responses already exist (Claude, decision D106). Work in a loop until every exit criterion in §5 holds.

## 0. Read first

1. `AGENTS.md`: §4 (ownership), §5 (standards), §10b (a held job is never sent to Telegram), §13 (testing), §14 (git).
2. `docs/architecture/03-api-contract.md`: the Jobs table row for `GET /jobs/needs-review`, and the **Needs review (C step 2, D106)** paragraph.
3. `packages/types/src/api/jobs.ts`: `ReviewJobCard`, `HeldInfo`, `HeldKind`. Import these types; never hand-write them.
4. `docs/contracts/needs-review.mock.json`: real-shaped samples, with one card per `held.kind`, an empty response, and 401/400 errors.
5. The existing Jobs page (`apps/web/app/(app)/jobs/…`), `components/jobs/*`, `hooks/useJobs.ts` and `hooks/useFilterParams.ts`. Reuse the job card and the filters rather than duplicating them.

## 1. Scope

- Edit only `apps/web/**`, plus an append-only line in `CHANGELOG.md`. Never touch `apps/api`, `packages` or `docs/architecture`.
- If the contract is missing something, stop and request it in your report. Do not work around it.
- All data comes through `useApi()`. No direct Supabase queries.

## 2. What to build

- **Hook:** `useNeedsReview(filters)` calls `GET /jobs/needs-review` with the same query parameters as `useJobs` (cursor pagination, filters), and is typed `ReviewJobCard[]`.
- **Placement:** a **"Needs review"** tab or segmented control on the Jobs page, next to the default list. Show a count badge if one is cheap to get (otherwise none; don't add an API call just for a count). The **default list must stay unchanged**: held jobs never appear in it.
- **Card:** reuse the job card and add a clear **"Held"** banner showing `held.label` verbatim. Give each `held.kind` its own icon and colour, and a tooltip with more detail:
  - `CATEGORY_UNKNOWN`: "We couldn't tell what kind of work this is from the posting."
  - `COMPANY_UNVERIFIED`: "We couldn't confirm the employer. Check the company before applying."
  - `URL_UNREACHABLE`: "The application page didn't open when we checked."
  - `OTHER`: show `held.reason`.
- **Header note** on the view, verbatim: "These jobs passed the India, fresher and 60-day checks but couldn't be fully verified. They're never sent to Telegram. Check each one before applying."
- **Actions:** the same as the normal list (open detail, save, mark applied), so the tracker keeps working. The apply button must show a caution step first: "This job isn't verified. Open anyway?"
- **States:** loading skeleton; empty ("Nothing needs review right now"); error with retry; 401 handled by the existing auth flow.
- **Responsive and theme:** 375px (stacked cards, no horizontal scroll) and 1280px, light and dark mode, keyboard accessible, aria labels on the held banner and icons.
- **Stable selectors** (needed by the F9 tests):
  - `data-testid="needs-review-tab"`
  - `needs-review-list`
  - `needs-review-empty`
  - `needs-review-error`
  - `held-banner-<jobId>`
  - `held-kind-<jobId>` (its text is the kind)
  - `apply-caution-confirm`

### Also in this task (small, from the verification report)

- **System Status:** show today's AI calls per purpose from `status.ai.byPurpose`, which is optional. Show a short table (for example "Category check: 73"); hide it when the field is absent.
- **R6 test:** add a Vitest test proving that `JobCard` and the job detail page show **"Not disclosed"** when `salary.disclosed` is false or `salary.text` is null.

## 3. Tests (Vitest + Testing Library), driven by `docs/contracts/needs-review.mock.json`

1. Each of the 4 `held.kind` values renders its banner, icon and label (the label verbatim from the mock).
2. The tab calls `/jobs/needs-review` with the current filters; the default list still calls `/jobs`. Neither view ever shows the other's jobs.
3. The header note text is present.
4. The apply action shows the caution step first; confirming it opens the URL.
5. Loading, empty and error (with retry) states.
6. Pagination via `meta.nextCursor` works.

## 4. The loop

Repeat **PLAN → IMPLEMENT → RUN → TEST → DEBUG → VERIFY → DOCUMENT → COMMIT** until every exit criterion holds.

- **TEST:** run these from the repo root. All must pass with zero warnings.
  ```
  pnpm --filter @jobsentinel/web lint
  pnpm --filter @jobsentinel/web typecheck
  pnpm --filter @jobsentinel/web test
  pnpm --filter @jobsentinel/web build
  pnpm format:check
  ```
- **VERIFY:**
  - Check 375px and 1280px, light and dark mode, in every state.
  - Confirm Dashboard, Jobs (the default list and its filters), Applications (the tracker), Preferences, Settings and System Status (the F2 report card) still behave as before.
- **COMMIT:**
  - Work on branch `phase-13-needs-review-ui`, with commits like `feat(web): [P13] needs review view (C2)`.
  - Never commit `.env*`, `.next` or `dist`.
  - Do not merge into `main`. Claude reviews it first.

## 5. Exit criteria

- Every item in §2 works against the mock and against the real API.
- All §3 tests pass, and every command in §4 is green with zero warnings.
- Nothing is edited outside `apps/web/**`, apart from the `CHANGELOG.md` append.
- **Final report**, containing:
  - the files you changed;
  - test totals before and after;
  - what you checked at each breakpoint and in each theme;
  - anything you couldn't verify, marked **NOT VERIFIED** with the reason;
  - any contract change you need from Claude.
