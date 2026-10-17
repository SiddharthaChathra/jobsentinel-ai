# Gemini task — owner decisions, F8 and F3: web side

You are Gemini, owner of `apps/web` in JobSentinel AI. The backend for every item below is built, tested and documented (Claude, decisions D110–D115). Build the web side in a loop until every exit criterion in §5 holds.

## 0. Read first

1. `AGENTS.md`: §4 (ownership), §5 (standards), §10a (unknown experience is held), §12 (Adzuna attribution), §13 (testing), §14 (git).
2. `docs/architecture/03-api-contract.md`: the `JobsQuery` block (`includeUndisclosedSalary`, `postingType`), the **Needs review** paragraph (new kind `EXPERIENCE_UNKNOWN`), and **Card fields added in Phase 13**.
3. `packages/types/src/api/jobs.ts`: `JobCard.attribution` (`SourceAttribution`), `JobCard.postingType`, `JobMatchSummary.scoring`, `HeldKind`, `JobsQuery`. `packages/types/src/enums.ts`: `PostingType`, `MatchScoring`. `packages/types/src/domain/sources.ts`: `SystemStatus.ai.userCallLimit`. Import these types; never hand-write them.
4. `docs/contracts/needs-review.mock.json`: now includes an `EXPERIENCE_UNKNOWN` card.
5. `docs/architecture/00-decisions.md`: D110–D115, for the reasons behind each item.
6. Your own `components/jobs/*`, `hooks/useJobs.ts`, `hooks/useFilterParams.ts`, `app/(app)/jobs/*`, `app/(app)/system/page.tsx`.

## 1. Scope

- Edit only `apps/web/**`, plus an append-only line in `CHANGELOG.md`. Never touch `apps/api`, `packages` or `docs/architecture`.
- Claude added one entry to `HELD_CONFIG` in `JobCard.tsx` (`EXPERIENCE_UNKNOWN`, commit `1ef717f`) so `main` kept building when the contract changed. It is yours now: restyle it as you see fit.
- If the contract is missing something, stop and request it in your report. Do not work around it.

## 2. What to build

1. **Adzuna attribution (required by Adzuna's terms, D115).** When `job.attribution` is present, show `attribution.label` ("Adzuna") as a link to `attribution.url` (new tab, `rel="noopener noreferrer"`) on the **job card and the job detail page**. The terms require it **at least 116 × 23 px**: give the link element `min-width: 116px; min-height: 23px` (for example a small outlined badge "Jobs by Adzuna" with the word Adzuna as the link). When `attribution` is null or absent, show nothing. Selector: `data-testid="attribution-<jobId>"`.
2. **Salary filter (R6, D111).** The Jobs filters have **no salary filter today**. Add:
   - a minimum salary input (₹ per year; sends `salaryMin`);
   - a checkbox **"Include jobs that don't state a salary"**, **checked by default**. Send `includeUndisclosedSalary=false` only when it is unchecked and `salaryMin` is set.
   - Keep both in the URL via `useFilterParams`, like the other filters. Selectors: `salary-min-input`, `salary-undisclosed-toggle`.
3. **R6 detail-page test.** Your C2 report said the R6 test covers the job card **and the detail page**; it only renders `JobCard`. Add a test that renders the job detail page (or `JobDetail`) and asserts **"Not disclosed"** for `salary: null`, `disclosed: false`, and `text: null`, and the salary text when disclosed.
4. **Experience held (R2, D110).** Needs review now has `EXPERIENCE_UNKNOWN`: tooltip "The posting doesn't say how much experience it needs. Check before applying." Make sure a kind the UI does not know still renders as `OTHER` (no crash).
5. **Posting type (D114).** On the card and the detail page, a small badge for `CAMPUS_DRIVE` ("Campus drive") and `OFF_CAMPUS_PROGRAM` ("Off-campus programme"); nothing for `REGULAR` or when absent. Add a filter: multi-select "Posting type" sending `postingType=CAMPUS_DRIVE,OFF_CAMPUS_PROGRAM`. Selectors: `posting-type-<jobId>`, `posting-type-filter`.
6. **Rules-only score (F8, D112).** When `job.match.scoring === 'RULES_ONLY'`, show a quiet note next to the score: "Rules-only score" with tooltip "The AI budget was used up or the AI was unavailable; this score comes from the rules. It may be refined later." On the detail page, next to the match breakdown. Selector: `scoring-rules-only-<jobId>`.
7. **System Status.** Show `status.ai.userCallLimit` (optional) in the AI budget card: "Per-user limit: 100 calls/day". Hide it when absent.

States, themes and responsiveness as before: 375 px (no horizontal scroll) and 1280 px, light and dark mode, keyboard accessible, aria labels on badges and icons.

## 3. Tests (Vitest + Testing Library)

1. Attribution: rendered as a link with the right `href` when present, absent otherwise, on card and detail.
2. Salary filter: default request carries no `includeUndisclosedSalary`; unchecking with a minimum set sends `includeUndisclosedSalary=false`; the checkbox starts checked.
3. Detail page "Not disclosed" (all three undisclosed shapes) and disclosed text.
4. `EXPERIENCE_UNKNOWN` banner renders its label from the mock; an unknown kind falls back to `OTHER`.
5. Posting-type badge for both kinds, none for `REGULAR`; the filter sends `postingType`.
6. Rules-only note shown for `RULES_ONLY`, hidden for `AI_REFINED` and when absent.
7. System Status shows the per-user limit when present.

## 4. The loop

Repeat **PLAN → IMPLEMENT → RUN → TEST → DEBUG → VERIFY → DOCUMENT → COMMIT** until every exit criterion holds.

- **TEST:** from the repo root, all green with zero warnings:
  ```
  pnpm --filter @jobsentinel/web lint
  pnpm --filter @jobsentinel/web typecheck
  pnpm --filter @jobsentinel/web test
  pnpm --filter @jobsentinel/web build
  pnpm format:check
  ```
- **VERIFY:** 375 px and 1280 px, light and dark, every state. Confirm Dashboard, Jobs (both tabs, all filters), Applications, Preferences, Settings and System Status still behave as before.
- **COMMIT:** branch `phase-13-f3-web`, commits like `feat(web): [P13] Adzuna attribution and salary filter (D111, D115)`. Never commit `.env*`, `.next` or `dist`. Do not merge into `main`; Claude reviews first.

## 5. Exit criteria

- Every item in §2 works against the contract samples, and against the real API where you can sign in.
- All §3 tests pass; every §4 command is green with zero warnings.
- Nothing edited outside `apps/web/**`, apart from the `CHANGELOG.md` append.
- **Final report:** files changed; test totals before and after; what you checked at each breakpoint and theme; anything not verified, marked **NOT VERIFIED** with the reason, **and say exactly which component each test renders**; any contract change you need from Claude.
