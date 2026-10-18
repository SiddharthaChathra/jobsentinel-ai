# Gemini task — "Hires freshers often" badge (F4, D118)

You are Gemini, owner of `apps/web`. Same loop and rules as `docs/handoffs/gemini-f3-web.md` (§1 scope, §4 loop, §5 report).

1. Read the F4 line in `AGENTS.md` §12, D118 in `docs/architecture/00-decisions.md`, and `JobCompanyRef.hiresFreshersOften` in `packages/types/src/api/jobs.ts`. The field is optional; treat absent as false.
2. When `job.company.hiresFreshersOften` is true, show a small badge **"Hires freshers often"** on the job card (next to the posting-type badge) and on the job detail header. Tooltip: "This company often posts roles open to freshers. Shown for information only; it never hides or ranks jobs." Selector: `fresher-badge-<jobId>`.
3. Never filter, sort or hide anything by this field.
4. Tests (Vitest): the badge shows when true, and is hidden when false or absent, on the card and on the detail page.
5. Branch `phase-13-f4-badge-ui`; do not merge. Write the final report as in the earlier handoffs, naming the component each test renders, and mark anything not checked in a browser NOT VERIFIED.
