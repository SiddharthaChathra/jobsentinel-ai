# Gemini task — stable selectors for the browser tests (F9, D122)

You are Gemini, owner of `apps/web`. Same loop and rules as `docs/handoffs/gemini-f3-web.md` (§1 scope, §4 loop, §5 report).

The Playwright suite in `e2e/browser/journey.spec.ts` (Claude's) drives the real app. Today it finds elements by role and accessible name. **Do not change these names without telling Claude**, or CI will fail:

| Where                   | Locator the test uses                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| Sign-up form            | labels "Email", "Password", "Confirm password"; button "Create account"                          |
| Onboarding, upload      | `input[type="file"]`; button "Upload & analyze"                                                  |
| Onboarding, review      | text "Check what we found"; list named "Skills"; button "Confirm profile"                        |
| Onboarding, preferences | button "Start monitoring"                                                                        |
| Job list                | each card's title link (exact job title)                                                         |
| Filters                 | combobox "Date Posted" and option "Last 7 days"; `salary-min-input`; `salary-undisclosed-toggle` |
| Job detail              | combobox named "Status:" and option "Applied"                                                    |
| Salary display          | the text "Not disclosed"                                                                         |

**Add these test ids**, keeping the names above:

- `signup-submit` and `onboarding-upload`;
- `onboarding-confirm-profile` and `onboarding-start`;
- `job-card-<jobId>`, plus `job-card-title-<jobId>` on the title link;
- `filter-posted` on the Date Posted trigger;
- `tracker-status` on the status trigger.

Add a Vitest test that each id renders. Branch `phase-13-f9-selectors`; do not merge. Report as in the earlier handoffs. Claude will switch the spec to these ids after merging.
