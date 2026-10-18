# Gemini task — "placeholders skipped" on the source report card (D117)

You are Gemini, owner of `apps/web`. Small task; same loop and rules as `docs/handoffs/gemini-f3-web.md` (§1 scope, §4 loop, §5 report).

1. Read `AGENTS.md` §12 (the placeholder line), D117 in `docs/architecture/00-decisions.md`, `SourceReportRow.placeholdersSkipped` and `SourceReport.totals.placeholdersSkipped` in `packages/types/src/domain/sources.ts` (both optional), and `docs/contracts/source-report.mock.json` (the first source has 1).
2. On the System Status source report card, show **"Placeholders skipped: N"** per source when N > 0, with the tooltip "Talent-pool and general-application postings. Not jobs, so not counted as collected or kept." Show the total in the card's summary when > 0. Hide both when absent or 0. Selectors: `placeholders-skipped-<sourceId>`, `placeholders-skipped-total`.
3. Tests (Vitest): shown when > 0, hidden when 0 or absent, per source and in the total.
4. Branch `phase-13-placeholders-ui`; do not merge. Final report as in the earlier handoffs, naming the component each test renders.
