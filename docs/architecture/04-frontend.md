# 04 — Frontend Architecture (`apps/web`) — owned by Gemini, reviewed by Claude

## 1. Stack & principles

- **Next.js 15 (App Router), TypeScript strict, Tailwind CSS v4, shadcn/ui**, `lucide-react` icons.
- **Mobile-first.** Every screen is designed at 360 px width first, then widened. Bottom tab bar on `< md`, left sidebar on `≥ md`.
- **No business logic in the browser.** The web app renders what the API returns; scoring, validation, fresher decisions all happen server-side. The only client logic is UI state, filtering params, and optimistic tracker updates.
- **Types from `packages/types`.** Never redeclare API shapes in the frontend.
- **Data fetching:** TanStack Query for client components (caching, refetch on focus, optimistic mutations). Server Components fetch on initial render where it helps first paint (dashboard summary). One typed client `lib/api.ts` (fetch + bearer token + envelope unwrapping + error mapping).
- **Auth:** `@supabase/ssr` for session cookies; `middleware.ts` redirects unauthenticated users to `/login` and users without a completed onboarding to `/onboarding`.
- **State:** URL search params are the source of truth for job filters (shareable, back-button friendly). Small client stores (Zustand) only for UI ephemera (sheet open, theme).
- **Forms:** `react-hook-form` + `zodResolver` with the same Zod schemas the API uses.

## 2. Route map

```
app/
├── (auth)/
│   ├── login/page.tsx              email+password, magic link
│   ├── signup/page.tsx
│   └── auth/callback/route.ts      Supabase code exchange
├── (onboarding)/onboarding/
│   ├── page.tsx                    stepper shell
│   ├── upload/                     step 1: resume upload + parse status
│   ├── review/                     step 2: AI-suggested profile → edit/confirm
│   └── preferences/                step 3: roles, locations, categories, notifications, Telegram link
├── (app)/                          authenticated shell: sidebar / bottom tabs, top bar, inbox bell
│   ├── dashboard/page.tsx
│   ├── jobs/page.tsx               list + filter sheet/sidebar + search
│   ├── jobs/[id]/page.tsx          detail
│   ├── saved/page.tsx
│   ├── applications/page.tsx       kanban on desktop, grouped list on mobile
│   ├── resume/page.tsx             active resume, versions, re-analyze
│   ├── preferences/page.tsx
│   ├── system/page.tsx             System Status (sources, scans, worker, AI budget)
│   ├── settings/page.tsx           account, notifications, Telegram, theme, danger zone
│   └── notifications/page.tsx      web inbox
└── layout.tsx, error.tsx, loading.tsx, not-found.tsx
```

## 3. Component architecture

```
components/
├── ui/                    shadcn primitives (button, card, badge, sheet, dialog, tabs, skeleton, toast…)
├── layout/                AppShell, Sidebar, BottomTabs, TopBar, PageHeader, InboxBell
├── jobs/
│   ├── JobCard.tsx        title, company, location, fresher badge, salary, match ring, posted time, verification badge, actions
│   ├── JobList.tsx        virtualized infinite list (TanStack Virtual) — fast on mobile
│   ├── JobFilters.tsx     Sheet on mobile / sidebar on desktop; writes URL params
│   ├── JobDetail.tsx      sections: header, apply CTA (sticky on mobile), why-it-matches, description, requirements, validation, sources, events
│   ├── VerificationBadge.tsx   VALID / NEEDS_REVIEW / SUSPICIOUS with evidence popover
│   ├── MatchBreakdown.tsx      skill/role/experience/location bars + matched/missing chips
│   ├── PriorityBadge.tsx
│   ├── FresherBadge.tsx
│   └── TrackerActions.tsx      save, mark applied, status select, not interested
├── dashboard/             StatTiles, PrioritySummary, RecentJobs, TopMatches, SystemMini
├── onboarding/            ResumeDropzone, ParseStatus, ProfileReviewForm, SkillChips, RoleTierEditor
├── preferences/           PreferencesForm, CategoryPicker, LocationPicker, NotificationPrefs, TelegramLinkCard
├── system/                SourceTable, ScanRunList, WorkerStatus, AiBudgetMeter
└── common/                EmptyState, ErrorState, LoadingState, RelativeTime, ConfirmDialog, ThemeToggle
hooks/
├── useJobs(params)  useJob(id)  useSaveJob()  useTracker()  useDashboard()  useProfile()  usePreferences()
├── useSources()  useSystemStatus()  useNotifications()  useTelegramLink()
└── useFilterParams()   (URL ⇄ typed JobsQuery)
lib/
├── api.ts            typed client; throws ApiError {code, message, details}
├── supabase/         browser + server clients
├── format.ts         salary, dates (user timezone), relative time
├── queryKeys.ts
└── constants.ts      labels/colors for enums (single mapping, used everywhere)
```

## 4. Screen requirements (acceptance for Gemini)

| Screen        | Must have                                                                                                                                                                                                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard     | stat tiles (new today, Very High, High, needs review, saved, applied); top matches; recent jobs; mini system status with red state if worker dead > 1 h or any source FAILING                                                                                                                       |
| Jobs list     | search box (debounced), filter sheet (all `JobsQuery` filters), sort, infinite scroll, skeleton loading, empty state with "widen filters" CTA, "New" indicator, pull-to-refresh feel on mobile                                                                                                      |
| Job detail    | sticky APPLY NOW (opens `applicationUrl` in new tab, records VIEWED), verification badge with evidence popover, "why this job matches", full JD (sanitized HTML or markdown), requirements, deadline, sources list, tracker controls, review controls for NEEDS_REVIEW/SUSPICIOUS (Accept / Reject) |
| Saved         | list of saved cards, unsave                                                                                                                                                                                                                                                                         |
| Applications  | status columns (desktop) / grouped accordion (mobile), inline status change, notes                                                                                                                                                                                                                  |
| Resume        | active resume card, upload new version, re-run analysis, view suggested vs confirmed profile                                                                                                                                                                                                        |
| Preferences   | roles by tier (drag or select), locations, remote, employment types, categories, fresher-only toggle, salary min, instant alert threshold slider                                                                                                                                                    |
| System Status | source table (status pill, last/next scan, failures, manual scan button, enable toggle), recent scan runs, worker heartbeat, AI budget meter, pipeline counters                                                                                                                                     |
| Settings      | display name, notification mode, digest hour, quiet hours, Telegram link/unlink with deep link + QR, theme, sign out, delete data                                                                                                                                                                   |
| Global        | dark/light mode, keyboard accessible, `aria-*` on interactive components, focus rings, reduced-motion respect, toasts for mutations, error boundaries per route                                                                                                                                     |

## 5. Performance & responsiveness rules

- LCP < 2.5 s on a mid-range Android over 4G for `/jobs` (server-render first page, virtualize the rest).
- Images: none from job sources (no hotlinking company logos in MVP — avoids tracking/broken images); use initials avatar.
- Bundle: shadcn components imported individually; charts (if any) lazy-loaded.
- All lists paginated by cursor; never fetch "all jobs".

## 6. PWA (Phase 11)

`manifest.webmanifest`, icons, `theme-color`, `next-pwa`-free minimal service worker (cache shell + last dashboard response). No background sync (Telegram covers push).
