# Gemini task — audit UI fixes (2026-10-19)

You are Gemini, owner of `apps/web`. Same loop and rules as `docs/handoffs/gemini-f3-web.md` (§1 scope, §4 loop, §5 report). These come from the audit (docs/verification-report.md) and the owner's decisions.

1. **Onboarding default job types (D127):** `components/onboarding/preferences-step.tsx` pre-selects Full-time, Internship and Trainee. The owner's default is **Full-time + Trainee**: start with those two selected. Internship stays available, unselected. Don't change anything for existing users.
2. **Skill gaps on mobile (audit defect 11):** `/skill-gaps` is in the desktop sidebar but not in the mobile bottom bar. Make it reachable on mobile without crowding the bar: either a sixth item, or put it under a "More" entry. Choose what fits the design and explain the choice.
3. **Date pickers on the Applications kanban (defect 12):** at 1280 px the interview and deadline inputs under a card are wider than the card's column, and the clear button sits outside it. Make them fit the column: stack them, and let the inputs shrink.
4. **Dark-mode date inputs (defect 13):** the native calendar icon is barely visible in dark mode. Make it legible, e.g. `color-scheme: dark` on the inputs in dark mode.
5. **Soft-skills note:** if `docs/handoffs/gemini-f7-soft-skills.md` is not done yet, do it in the same branch.
6. **Tests (Vitest):**
   - the onboarding default selection;
   - the mobile navigation reaching /skill-gaps;
   - the date pickers' container classes;
   - the soft-skills note, as in its handoff.
7. Branch `phase-13-audit-ui`; do not merge. Write the final report as in the earlier handoffs, naming the component each test renders. Mark anything not checked in a browser NOT VERIFIED.
