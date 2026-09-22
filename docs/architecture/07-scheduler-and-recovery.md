# 07 — Scheduler & Recovery Architecture

## 1. Scheduler

### 1.1 Design

A **database-driven, lease-based scheduler**. There is no in-memory job queue and no cron table in code; the schedule _is_ the `job_sources.next_scan_at` column, and pipeline work _is_ the `jobs.status` column. The worker polls both on a tick (default 60 s). This means:

- restarting the worker loses nothing (state is in Postgres);
- running the worker as a one-shot process (`--once`) is exactly one tick;
- two workers would not double-process (leases + `SKIP LOCKED`), though we run one.

### 1.2 Due-source selection

```sql
UPDATE job_sources s SET lease_until = now() + interval '5 minutes', last_attempted_scan = now()
WHERE s.id IN (
  SELECT id FROM job_sources
  WHERE enabled AND status <> 'DISABLED'
    AND next_scan_at <= now()
    AND (lease_until IS NULL OR lease_until < now())
  ORDER BY priority_rank(priority), next_scan_at
  LIMIT $maxSources
  FOR UPDATE SKIP LOCKED
) RETURNING *;
```

`priority_rank`: HIGH → 0, NORMAL → 1, LOW → 2. Manual triggers set `next_scan_at = now()` and are therefore picked first within their priority; a manual trigger also forces `priority_rank = -1` via a `manual_requested_at` column check.

### 1.3 Intervals

| priority | default interval | intended for                                                   |
| -------- | ---------------- | -------------------------------------------------------------- |
| HIGH     | 10 min           | company career APIs of top-target companies, high-volume feeds |
| NORMAL   | 30 min           | most ATS sources                                               |
| LOW      | 60–180 min       | aggregators with request guidelines (Remotive), Adzuna         |

Per-source `scan_interval_sec` overrides. Interval is always ≥ the source's documented minimum; the config schema for each adapter carries `minIntervalSec` so a user cannot set an abusive value from the dashboard.

Spread: on boot, `next_scan_at` for sources with null values is staggered (`now() + i * 20 s`) so 30 sources don't fire at once.

### 1.4 Pipeline drains

```
DISCOVERED     → ClassificationService  → CLASSIFIED | FILTERED_OUT
CLASSIFIED     → ValidationOrchestrator → VALID | SUSPICIOUS | NEEDS_REVIEW | EXPIRED | REJECTED | AI_PENDING
VALID/NEEDS_REVIEW (no match for current profile_version) → MatchingService → MATCHED | AI_PENDING
MATCHED        → NotificationDecision   → NOTIFY_PENDING | NOTIFIED(skipped)
NOTIFY_PENDING → Dispatcher             → NOTIFIED
AI_PENDING     → retried when budget resets (daily) or provider recovers (every 15 min probe)
```

Each drain: `SELECT … WHERE status = $s AND (stage_attempts < 5) ORDER BY first_seen_at LIMIT batch FOR UPDATE SKIP LOCKED`. A stage exception sets `stage_error`, increments `stage_attempts`, leaves `status` unchanged; after 5 attempts the job is parked in `NEEDS_REVIEW` with `stage_error` visible in the dashboard. Every drain has a time budget so a tick never exceeds ~3 minutes.

### 1.5 Re-check schedule (closed-job detection)

`jobs.next_check_at` for active jobs: `validated_at + 6 h`, then `+24 h`, then `+72 h` repeating, until `EXPIRED` or `first_seen_at + 45 days` (then auto-EXPIRED with reason `STALE`). Re-check = availability probe of `final_application_url` (+ source-specific check, e.g. Greenhouse job endpoint 404). A job that a source re-lists resets `last_seen_at`; a job that a source _stops_ listing for 2 consecutive successful scans **and** whose URL probe fails → EXPIRED. Listing disappearance alone is not enough (feeds truncate).

### 1.6 Digest scheduling

`DigestService` runs each tick: for each user with mode DIGEST/BOTH, if local time ≥ `digest_hour_local` and no `notifications(type=DIGEST, digest_date=today_local)` exists → build and send. The unique index makes this idempotent even across restarts.

## 2. Recovery architecture ("never permanently lose a job")

### 2.1 Cursor semantics

- `last_successful_scan` is set to the **`scan_started_at` of the successful run**, not its completion time. Anything posted during the run is re-covered next time (overlap is safe because ingestion is idempotent).
- Adapters are asked for `since = last_successful_scan − overlap` (overlap 15 min by default) — jobs are deduplicated, so re-seeing them is cheap.
- If an adapter has no time filter (most ATS list endpoints), it returns the full current list every scan; the cursor is then only informational and "missed jobs" cannot happen unless the job was posted and removed entirely between scans.
- A failed run **never advances** the cursor. A source failing for a day then recovering fetches "since yesterday".

### 2.2 Failure modes and responses

| Failure                                             | Detection                                                                               | Response                                                                                                                                                                                          |
| --------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker crash mid-scan                               | `scan_runs.status = RUNNING` with `started_at < now() − timeout`; `lease_until` expired | `RecoveryService.sweep()` marks run `FAILED('orphaned')`, clears lease; source becomes due immediately; cursor untouched                                                                          |
| Worker crash mid-pipeline                           | jobs left in a status with a stale lock (row locks vanish with the connection)          | next tick simply re-selects them — stages are idempotent                                                                                                                                          |
| Worker not running for hours/days (free host slept) | `worker_heartbeats.last_beat_at` old; dashboard shows red                               | on restart: all sources are due; scheduler processes them in priority order, bounded per tick; `since` covers the gap; a `RECOVERY` scan_run trigger is recorded for runs where gap > 2× interval |
| Source down / 5xx / timeout                         | HttpClient error                                                                        | backoff table (doc 06 §7), other sources unaffected                                                                                                                                               |
| Source 403/429                                      | status code                                                                             | respect `Retry-After`; mark DEGRADED/BLOCKED; never retry aggressively                                                                                                                            |
| Adapter throws on one malformed record              | per-record try/catch                                                                    | record skipped + logged (`jobs_skipped++`), scan continues                                                                                                                                        |
| DB temporarily unavailable                          | connection error                                                                        | tick aborts, logged, retried next tick with backoff (5 s → 60 s); nothing partially committed thanks to transactions                                                                              |
| AI provider down / invalid JSON                     | `AIResult.status`                                                                       | job → `AI_PENDING` with `next_attempt_at`; deterministic-only fallback used for classification/matching where defined (doc 09)                                                                    |
| Telegram send fails                                 | API error                                                                               | notification `PENDING` with attempts/backoff (1 m, 5 m, 30 m, 2 h, 12 h), then `FAILED` and visible in the web inbox; the job's `notified_at` is set only on SENT                                 |
| Internet down entirely                              | all HTTP fails                                                                          | same as source down; heartbeat still written locally if DB reachable, otherwise nothing changes                                                                                                   |
| Job closes after discovery                          | re-check probe                                                                          | EXPIRED, hidden from default views, tracker entries kept                                                                                                                                          |

### 2.3 Recovery sweep (every tick, cheap)

1. Orphaned `scan_runs` (RUNNING > timeout) → FAILED.
2. Expired leases → cleared.
3. Jobs stuck in `VALIDATING` > 30 min (status set but no validation row update) → back to `CLASSIFIED`.
4. Sources with `next_scan_at` null → set now().
5. Once a day: housekeeping/retention (doc 02 §8).

### 2.4 Manual recovery tools (System Status page / CLI)

- "Re-scan since <date>" for a source (sets `last_successful_scan` back).
- "Re-validate" / "Re-match" a job.
- `pnpm worker --once --sources=<id>` for ad-hoc runs from a laptop.
