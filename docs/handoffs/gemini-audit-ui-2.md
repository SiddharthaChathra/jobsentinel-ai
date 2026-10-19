# Gemini task: audit UI follow-up (2026-10-19)

You are Gemini, owner of `apps/web`. The loop and rules are the same as in `docs/handoffs/gemini-f3-web.md` (§1 scope, §4 loop, §5 report). Claude found these two issues while re-capturing the X9 screenshots after `phase-13-audit-ui` was merged.

1. **/applications hides an API failure (audit defect 14, MEDIUM).**
   - **Problem:** when `GET /api/v1/applications` fails (a 500 after React Query's retries), the page shows the empty state, "No applications tracked yet".
   - **Why it matters:** a user with tracked applications would believe they had lost them.
   - **Cause:** `app/(app)/applications/page.tsx` reads only `isLoading` from `useApplications()`.
   - **Fix:** show an error state with a retry button, as `/skill-gaps` does. Show the empty state only when the request succeeded and returned no rows.
2. **The interview date-time is cut off in the kanban (defect 12, still open).**
   - **Problem:** at 1280 px the stacked Interview input shows "21-10-2026 14…", and the time is clipped. The Deadline field (date only) fits.
   - **Fix:** make the full date and time readable within the column. For example, let the input take the full width and move the clear button onto its own line or inside the label row, or use a smaller text size for the input. Keep the 375 px layout as it is, since it already fits.
3. **Tests (Vitest):**
   - the applications page renders the error state, not the empty state, when the hook reports an error;
   - the interview input and its clear button are not in the same flex row (or whatever layout you choose; assert it).
4. Use branch `phase-13-audit-ui-2` and do not merge. Write the final report as in the earlier handoffs, naming the component each test renders. Mark anything you did not check in a browser NOT VERIFIED.
