# Gemini task — tracker reminders UI (F5, D119)

You are Gemini, owner of `apps/web`. Same loop and rules as `docs/handoffs/gemini-f3-web.md` (§1 scope, §4 loop, §5 report).

**Read first:** the F5 line in `AGENTS.md` §10b, D119 in `docs/architecture/00-decisions.md`, "Tracker reminders" in `docs/architecture/03-api-contract.md`, `packages/types/src/api/reminders.ts` (`ReminderItem`, `ReminderSnoozeInput`, `ApplicationDatesInput`), the new optional `ApplicationItem` fields in `packages/types/src/api/jobs.ts`, and the samples in `docs/contracts/reminders.mock.json`.

1. **Applications page: due reminders.** At the top, a "Reminders" section listing `GET /api/v1/reminders`:
   - DUE items first, highlighted; then UPCOMING with their date in the user's timezone.
   - Each row shows `message` and links to the job.
   - Each row has **Snooze** (1 day by default; also 1 hour and 3 days) and **Dismiss** buttons.
   - Hide the section when the list is empty.
   - Selectors: `reminder-<id>`, `reminder-snooze-<id>`, `reminder-dismiss-<id>`.
2. **Date pickers per application:**
   - **Interview date and time**, and **Deadline** (date; send 23:59 local as ISO). A **Clear** for each sends `null`.
   - Save with `PATCH /api/v1/applications/:jobId/dates`.
   - Show `followUpAt` read-only ("Follow-up reminder on …") when present.
   - Selectors: `interview-date-<jobId>`, `deadline-date-<jobId>`.
   - Also offer the deadline picker on a saved job.
3. **Notification settings:** add a "Reminders" toggle (`remindersEnabled`), "Follow up after N days" (3-14, `followUpDays`), and "Weekly summary on Sunday 09:00" (`weeklySummaryEnabled`, off by default). All three are optional in the type; treat absent as the defaults.
4. **Inbox:** `REMINDER` and `WEEKLY` items render like system items (the API sends `title` and `body`).
5. **States:** loading, empty and error for the reminders list. Mobile (375px) and desktop, light and dark.
6. **Tests (Vitest):**
   - DUE and UPCOMING render.
   - Snooze and dismiss call the right endpoints, and the row updates or disappears.
   - The date pickers send ISO or null.
   - The settings fields round-trip.
   - The empty list hides the section.
7. Branch `phase-13-f5-reminders-ui`; do not merge. Write the final report as in the earlier handoffs, naming the component each test renders. Mark anything not checked in a browser NOT VERIFIED.
