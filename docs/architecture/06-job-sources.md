# 06 — Job-Source Architecture

## 1. Principles

1. **Permitted access only.** A source is supported only if it exposes a public API/feed, or a public HTML page whose `robots.txt` allows our user agent and whose terms don't forbid automated access. We identify ourselves (`User-Agent: JobSentinelAI/1.0 (+contact email)`), obey `Retry-After`, throttle per host, and never attempt CAPTCHA, login walls, header spoofing, proxy rotation or anti-bot evasion. If a source starts blocking (403/429/challenge page), the adapter marks it `BLOCKED`, backs off, and eventually disables itself — it never "tries harder".
2. **Adapters are plugins.** Each adapter is a class implementing `JobSource`, registered by name; sources are rows in `job_sources` referencing an adapter + config. Adding a source = adding a row; adding a source _type_ = adding a class + registering it.
3. **Cursor-based, recoverable fetching.** Adapters return everything since `ctx.since` (or all currently listed jobs when the API has no time filter); the scheduler owns the cursor.
4. **Raw first, normalize second.** Adapters emit `RawJob` (loose) and never do business classification. Normalization is a separate, pure, unit-tested step.

## 2. Interfaces

```ts
interface RawJob {
  externalId: string; // stable id from the source
  title: string;
  companyName?: string; // may come from config for single-company sources
  companyDomain?: string;
  locationText?: string;
  isRemote?: boolean;
  descriptionHtml?: string;
  descriptionText?: string;
  employmentTypeText?: string;
  experienceText?: string;
  salaryText?: string;
  postedAt?: Date;
  updatedAt?: Date;
  deadline?: Date;
  sourceUrl: string; // listing page
  applicationUrl?: string; // apply page (falls back to sourceUrl)
  departments?: string[];
  raw: unknown; // stored (bounded) for debugging
}

interface FetchContext {
  since: Date | null; // last_successful_scan (null → full fetch)
  cursor: string | null; // adapter-defined
  http: HttpClient; // rate-limited, timeout, retry
  logger: Logger;
  maxItems: number; // safety cap per run (default 500)
  setCursor(next: string | null): void;
}

interface SourceMetadata {
  name: string;
  type: SourceType;
  docsUrl?: string;
  defaultPriority: SourcePriority;
  supportsSince: boolean;
  supportsCursor: boolean;
  politenessMs: number; // min gap between requests to this host
}
```

## 3. Adapter catalogue

| Adapter           | Type        | Config                                                                     | Access basis                                                                                     | Notes                                                                                                                                                     |
| ----------------- | ----------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `greenhouse`      | ATS_API     | `{ boardToken }`                                                           | Public Job Board API (`boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true`)            | Returns full JSON incl. `absolute_url`, `updated_at`, location, content. Closed jobs disappear → availability check via `GET …/jobs/{id}` (404 ⇒ closed). |
| `lever`           | ATS_API     | `{ site }`                                                                 | Public postings API (`api.lever.co/v0/postings/{site}?mode=json`)                                | `createdAt`, `applyUrl`, `categories.location/commitment/team`.                                                                                           |
| `ashby`           | ATS_API     | `{ jobBoardName }`                                                         | Public job-posting API (`api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true`) | `isRemote`, `publishedAt`, `applyUrl`, compensation.                                                                                                      |
| `smartrecruiters` | ATS_API     | `{ companyIdentifier }`                                                    | Public postings API (`api.smartrecruiters.com/v1/companies/{id}/postings`)                       | Paginated; details need a second call per job (bounded).                                                                                                  |
| `workable`        | ATS_API     | `{ subdomain }`                                                            | Public widget API (`{subdomain}.workable.com/spi/v3/jobs`)                                       | Details per job.                                                                                                                                          |
| `remotive`        | PUBLIC_API  | `{ category?, search? }`                                                   | Public API (`remotive.com/api/remote-jobs`)                                                      | Remote roles only; respects their "not more than a few requests/day" guideline → LOW priority.                                                            |
| `rss`             | RSS         | `{ feedUrl, companyNameFrom?: 'title'\|'author'\|'fixed', fixedCompany? }` | Any public RSS/Atom feed (e.g. WeWorkRemotely categories)                                        | Generic; parses with `rss-parser`. GUID → externalId.                                                                                                     |
| `adzuna`          | PUBLIC_API  | `{ country:'in', what, where?, maxDaysOld }`                               | Adzuna Jobs API (free key, documented limits)                                                    | Aggregator: good breadth for Indian fresher roles; `redirect_url` → application URL validation matters more here. Disabled until `ADZUNA_APP_ID/KEY` set. |
| `career_page`     | CAREER_PAGE | `{ url, listSelector, fields:{title, url, location?}, pagination? }`       | Public HTML page, **only if** `robots.txt` allows and no anti-bot                                | Phase 4.5+. cheerio static parse first; Playwright only for pages that render client-side _and_ permit it. Per-domain 1 req / 5 s.                        |

Explicitly **not supported**: LinkedIn, Naukri, Indeed, Glassdoor, Instahyre, Unstop-style platforms that require login or prohibit scraping. If any of these expose an official, permitted API later, they get an adapter like any other.

## 4. Source registry & manager

```mermaid
sequenceDiagram
    participant S as SchedulerService
    participant M as SourceManager
    participant A as Adapter
    participant N as NormalizerService
    participant D as DedupeService
    participant DB as Postgres
    S->>M: runScan(sourceRow, trigger)
    M->>DB: insert scan_runs RUNNING
    M->>A: fetchJobs(cfg, ctx{since,cursor})
    loop each RawJob
        A-->>M: RawJob
        M->>N: normalize(raw, sourceRow)
        N-->>M: NormalizedJob
        M->>D: upsert(normalized, sourceRow)
        D->>DB: mapping upsert / canonical insert or attach
    end
    M->>DB: scan_runs SUCCEEDED, counts; job_sources cursor+last_successful_scan
    alt error
        M->>DB: scan_runs FAILED, last_error, consecutive_failures++, backoff next_scan_at
    end
```

- `SourceRegistry` maps adapter name → provider class; unknown adapter names in the DB are logged and skipped, not fatal.
- `SourceManager.runScan` is the single unit of failure isolation: one source, one try/catch, one scan_runs row, hard timeout (`SOURCE_SCAN_TIMEOUT_MS`, default 120 s) → `TIMED_OUT`.
- `HttpClient` enforces per-host token buckets (`politenessMs`), 15 s request timeout, max 3 retries on 5xx/network with exponential backoff + jitter, no retry on 4xx, honors `Retry-After`, caps response body at 5 MB.

## 5. Normalization (`NormalizerService`, pure functions in `packages/validation`)

| Field                | Rule                                                                                                                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `normalized_title`   | lowercase, strip punctuation/brackets, collapse whitespace, remove seniority noise words only for dedupe key (kept in `title`), map synonyms (`sde` → `software development engineer`)                                                                         |
| `role_family`        | taxonomy match on title tokens (config table: `software_engineer`, `sde`, `technical_support_engineer`, `network_engineer`, `cloud_engineer`, `devops_engineer`, `data_engineer`, `data_analyst`, `qa_engineer`, `mechanical_engineer`, …); fallback `unknown` |
| `category`           | from role_family + department + skills keywords → `job_category`                                                                                                                                                                                               |
| `normalized_company` | lowercase, strip legal suffixes (pvt ltd, inc, llc, limited), diacritics                                                                                                                                                                                       |
| `location`           | split on `,`/`                                                                                                                                                                                                                                                 | `/`/`; city dictionary (Indian metros + common intl); country inference; `is_remote` if remote/wfh/anywhere tokens or adapter flag |
| `employment_type`    | keyword map (intern/internship → INTERNSHIP, trainee/apprentice → TRAINEE, contract → CONTRACT, part-time → PART_TIME, else FULL_TIME if stated, else UNKNOWN)                                                                                                 |
| `experience`         | regex families: `0-2 years`, `0 to 1 yr`, `fresher`, `2+ years`, `minimum 3 years` → `(min, max)`; text kept in `experience_text`                                                                                                                              |
| `salary`             | currency symbols/codes (₹, INR, LPA, lakhs, $, USD, €), ranges, per-year/month/hour; `LPA` ×100000; never guess currency — if absent and location is India, `currency = INR` with `evidence = 'inferred'`                                                      |
| `skills`             | dictionary + alias match over description; cap 40                                                                                                                                                                                                              |
| `description`        | HTML → text (sanitized), strip boilerplate (EEO statements optional), trim to 20 k chars                                                                                                                                                                       |
| `application_url`    | absolute, https upgrade if host supports it, strip tracking params (`utm_*`, `gh_src`, `lever-source`)                                                                                                                                                         |
| `posted_at`          | prefer source `postedAt`, else `updatedAt`, else null (never `now()` — `first_seen_at` records that)                                                                                                                                                           |

## 6. Duplicate detection (`DedupeService`)

Order of checks (first hit wins, all deterministic):

1. `(source_id, external_id)` mapping exists → **update** (refresh `last_seen_at`, diff `content_hash` → `jobs_updated`, re-validate if application URL changed).
2. Same `final_application_url` or `application_url` (after normalization) on another job → **attach** mapping to that job.
3. Same `dedupe_key` (`sha1(normalized_company | normalized_title | location_key)`) → attach.
4. Same company + SimHash Hamming distance ≤ 6 on description + title token Jaccard ≥ 0.6 → attach (log `DEDUPED_FUZZY` event for audit).
5. Otherwise → **insert** canonical job.

"Same company posts multiple similar jobs" (e.g. SDE-1 Bengaluru vs SDE-1 Hyderabad) stays separate because the location key differs and descriptions typically differ by location tokens; the fuzzy rule requires both description similarity _and_ title similarity, and different `external_id`s from the _same_ source never merge (step 4 is skipped when both mappings come from one source with different ids).

## 7. Source health

| consecutive_failures  | status                          | next_scan_at                           |
| --------------------- | ------------------------------- | -------------------------------------- |
| 0                     | ACTIVE                          | interval by priority                   |
| 1–2                   | DEGRADED                        | interval × 2                           |
| 3–5                   | FAILING                         | 2 h, 4 h, 8 h                          |
| > 5                   | FAILING                         | 24 h; SYSTEM notification to user once |
| any 403/451/challenge | BLOCKED flag → DISABLED after 3 | manual re-enable only                  |

System Status shows all of this; the user can trigger a manual scan or disable a source.

## 8. Adding a company (dashboard, admin)

`POST /sources` with `{ adapter:'greenhouse', config:{boardToken:'acme'}, companyId? }` → API runs `validateSource()` synchronously (one request) → on success creates the row with `next_scan_at = now()`. `companies` row is created/linked with `ats_provider/ats_slug`, which the validation engine later uses as domain-relationship evidence.
