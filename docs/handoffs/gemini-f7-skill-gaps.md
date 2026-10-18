# Gemini task — /skill-gaps page (F7, D120)

You are Gemini, owner of `apps/web`. Same loop and rules as `docs/handoffs/gemini-f3-web.md` (§1 scope, §4 loop, §5 report).

**Read first:** the F7 line in `AGENTS.md` §10a, D120, "Skill gaps" in `docs/architecture/03-api-contract.md`, `SkillGapReport` in `packages/types/src/api/reminders.ts`, and `docs/contracts/skill-gaps.mock.json`.

1. **New page `/skill-gaps`** (in the app navigation, after Applications):
   - Header: "Based on your top N matches" (`basedOn`).
   - One row per gap: **"<skill> — missing in <missingIn> of <of>"** with a bar proportional to `missingIn / of`.
   - Up to 3 example jobs linking to `/jobs/<id>`.
   - The learning links, opening in a new tab with `rel="noopener noreferrer"`.
2. **Unlinked skills:** when `links` is empty, show the skill without links. Never build or guess a URL.
3. **Empty state** (`basedOn: 0`): "No matches yet — upload a resume or check back after the next scan."
4. Loading, error, mobile (375px) and desktop, light and dark.
5. **Selectors:** `skill-gap-<skill>` (spaces as `-`), `skill-gap-links-<skill>`.
6. **Tests (Vitest):**
   - Rows render with counts.
   - Linked and unlinked gaps both render.
   - The empty state shows.
   - The links have `target="_blank"` and `rel`.
7. Branch `phase-13-f7-skill-gaps-ui`; do not merge. Write the final report as in the earlier handoffs, naming the component each test renders. Mark anything not checked in a browser NOT VERIFIED.
