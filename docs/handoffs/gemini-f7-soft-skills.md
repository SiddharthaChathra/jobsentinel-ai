# Gemini task — soft-skills note on /skill-gaps (F7, D120 amended)

You are Gemini, owner of `apps/web`. Same loop and rules as `docs/handoffs/gemini-f3-web.md` (§1 scope, §4 loop, §5 report).

1. Read the amended D120 and `SkillGapReport.softSkills` in `packages/types/src/api/reminders.ts`. It is optional; treat absent as empty. Samples are in `docs/contracts/skill-gaps.mock.json`.
2. Below the ranked gaps on `/skill-gaps`, when `softSkills` is non-empty, show a short note:
   - a heading **"Soft skills"**;
   - one line per item, "Communication — mentioned in 11 of 15";
   - no links and no bars, kept visually lighter than the gaps.
   - Selector: `soft-skills-note`. Hide it when empty or absent.
3. Never move a soft skill into the ranked gaps.
4. Tests (Vitest): the note shows with items, and is hidden when empty or absent.
5. Branch `phase-13-f7-soft-skills-ui`; do not merge. Write the final report as in the earlier handoffs; mark anything not checked in a browser NOT VERIFIED.
