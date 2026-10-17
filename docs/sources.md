# Job sources (live reference)

Design: [architecture/06-job-sources.md](architecture/06-job-sources.md), [architecture/07-scheduler-and-recovery.md](architecture/07-scheduler-and-recovery.md). This page documents what is implemented and how to operate it.

## Access rules (non-negotiable)

Every adapter uses a **public, documented endpoint** and identifies itself with `HTTP_USER_AGENT`. Requests go through one `HttpClient` that resolves DNS first and refuses private/loopback/link-local targets on every redirect hop (NAT64 `64:ff9b::/96` addresses are decoded to their embedded IPv4 before the check), honours `Retry-After`, retries only 5xx/network errors, caps bodies at 20 MB and spaces requests per host. A 403/429 makes the adapter throw `SourceBlockedError`: the source backs off and disables itself after three strikes — nothing ever retries harder, rotates identities or evades a block.

## Adapters

| adapter      | config                                                        | endpoint                                                                | notes                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `greenhouse` | `{ boardToken }`                                              | `boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true`          | `content` is entity-escaped HTML → unescaped, sanitized, converted to text. Embedded boards use `?gh_jid=` in `absolute_url` — that param is an identifier and is never stripped. |
| `lever`      | `{ site }`                                                    | `api.lever.co/v0/postings/{site}?mode=json`                             | `text` is the title; `createdAt` is epoch ms; `categories.allLocations` + `country`.                                                                                              |
| `ashby`      | `{ jobBoardName }`                                            | `api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true` | Address-derived location, `isRemote`, compensation summary when public.                                                                                                           |
| `remotive`   | `{ category?, search?, limit }`                               | `remotive.com/api/remote-jobs`                                          | Their guideline asks for a low rate: LOW priority, ≥ 1 h interval, 5 s politeness.                                                                                                |
| `rss`        | `{ feedUrl, companyNameFrom, titleSeparator, fixedCompany? }` | any RSS/Atom feed                                                       | WeWorkRemotely style `Company: Title` handled by `companyNameFrom: "title"`.                                                                                                      |
| `adzuna`     | seeded, **no adapter yet**                                    | —                                                                       | Row exists (disabled) so keys can be added later; adapter is backlog.                                                                                                             |

All five live adapters were verified against the real endpoints on 2026-09-22 (fixtures under `apps/api/test/fixtures/sources/`).

## Pipeline per scan

`SchedulerService.leaseDueSources` (SKIP LOCKED, manual requests first, then HIGH → NORMAL → LOW) → `SourceManager.runScan`:

1. `scan_runs` row (`RUNNING`), adapter config validated with its Zod schema.
2. `adapter.fetchJobs()` streams `RawJob`s; each is normalized (`normalizeRawJob`: title/company/location/employment/experience/salary/skills/URL cleanup, sanitized-HTML→text, dedupe key, SimHash, content hash). Bad records are skipped and counted, never fatal.
3. Batches of 50 go through `DedupeService.upsertBatch` in one transaction: existing mapping → application URL → dedupe key → SimHash + title similarity within the same company → within-batch duplicates → new. Only the _primary_ mapping may update canonical content; secondary postings only refresh `last_seen_at`.
4. On success: `last_successful_scan = scan start`, `next_scan_at = now + interval`, health reset. On failure: cursor untouched, backoff `interval×2` (DEGRADED, 1–2 failures) → 2h/4h/8h (FAILING) → 24h; blocked ×3 → DISABLED.
5. Scan timeout: `SOURCE_SCAN_TIMEOUT_MS` (default 10 min); a timed-out scan keeps what it ingested and is marked `TIMED_OUT`.

Throughput measured from a residential uplink: ~7 jobs/s (MongoDB's 401 postings in ~60 s). Bytes per job were the bottleneck, so only plain text is stored (HTML is regenerated on demand) and raw payloads are stripped of description fields.

## Worker

`node dist/worker.js` (loop, `WORKER_TICK_MS`) or `--once` (single tick, for cron hosts). Flags: `--sources=<id,id>` scans those sources immediately regardless of schedule. Each tick: heartbeat → recovery sweep (orphaned `RUNNING` runs older than 2× timeout → `FAILED`, expired leases cleared, stuck `VALIDATING` jobs reset) → due scans (bounded fan-out, `WORKER_MAX_SOURCES_PER_TICK` / 8 in `--once`) → daily retention. Every stage is isolated; the loop never dies.

Verified crash behaviour: killing the worker mid-scan left `RUNNING` runs and a lease; the next tick repaired both, rescanned, and produced 0 duplicate mappings and 0 duplicate dedupe keys across 2,600+ jobs.

## Admin API

`GET /api/v1/sources`, `GET /sources/adapters`, `POST /sources` (validates config + reachability), `PATCH /sources/:id` (enable/priority/interval/config; re-enabling resets health), `POST /sources/:id/scan` (queues a manual scan, 202), `POST /sources/:id/validate`, `GET /sources/:id/scan-runs`. All admin-only. `GET /system/status` (any user) reports worker heartbeat, source health, last scans, pipeline counters and 24 h totals.

## Adding a source

Dashboard (Phase 8) or `POST /sources` with e.g. `{ "name": "Greenhouse: Acme", "adapter": "greenhouse", "config": { "boardToken": "acme" }, "priority": "NORMAL", "companyId": "<uuid>" }`. **Check the company behind a slug first**: slugs are global namespaces — Lever `porter` and Ashby `navi` belong to unrelated US companies, not the Indian ones, which is why they were removed from the seed. Look at the locations of a board's postings before trusting it.

**Company check before enabling a board (D115).** Pass only when the postings name the company **and** either the company's own careers page links that exact board (`jobs.lever.co/<slug>`, `boards.greenhouse.io/<slug>`, `jobs.ashbyhq.com/<slug>`) or the postings carry the company's domain; the domain must resolve and its homepage load. Add a seeded source to a live database with `pnpm db:seed -- --only="Greenhouse: Acme"` — a full re-seed resets every source's `enabled` and `priority`.

**Proposed, not enabled (2026-10-18, networking / cloud / DevOps).** Boards that exist and passed the company check, with India postings at that date; none had a fresher-titled India posting: Zscaler (Greenhouse `zscaler`, 68 India), Netskope (Greenhouse `netskope`, 19), Kong (Ashby `kong`, 13; konghq.com links it), Harness (Greenhouse `harnessinc`, 9), New Relic (Greenhouse `newrelic`, 8), JFrog (Greenhouse `jfrog`, 6), Sumo Logic (Greenhouse `sumologic`, 5), Aviatrix (Greenhouse `aviatrix`, 5). Fastly (3 India) is below the five-posting policy. Not found on a public Greenhouse/Lever/Ashby board under the obvious slug: DigitalOcean, HashiCorp, Couchbase, Infoblox, Cohesity, Postman, BrowserStack, Gigamon, A10, Extreme, Aryaka, Versa, HighRadius (many use Workday or their own sites, which are not supported).

## Known gaps (backlog)

Adzuna adapter (key-gated), `career_page` HTML adapter (robots.txt-gated), SmartRecruiters/Workable. `since`/cursor support is unused by current adapters (they return the full board), so "missed jobs" cannot happen unless a posting appears and disappears between two scans.
