# 05 — Backend Architecture (`apps/api`, NestJS)

## 1. Two entrypoints, one application

```
apps/api/src/
├── main.ts        → NestFactory.create(AppModule)            HTTP API (port 4000)
├── worker.ts      → NestFactory.createApplicationContext(WorkerModule)   no HTTP; runs WorkerLoop
└── app.module.ts / worker.module.ts
```

|               | `AppModule` (API)                                                                                                                                     | `WorkerModule` (worker)                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Imports       | auth, users, resumes, jobs, sources(read + manual trigger), validation(read + enqueue), matching(read), notifications(settings, link), system, common | sources, scheduler, jobs, validation, matching, notifications(dispatch, telegram poller, digest), system(heartbeat, housekeeping), common |
| Never does    | long-running scans, outbound Telegram sends (except `/notifications/test` → enqueues)                                                                 | serve HTTP (exposes a tiny `/healthz` on `WORKER_HEALTH_PORT` only if set)                                                                |
| Process flags | —                                                                                                                                                     | `--once` (drain due work and exit), `--sources=<ids>`, `--no-telegram`                                                                    |

Rationale: identical DI graph and modules, different composition roots. A manual scan from the dashboard just sets `job_sources.next_scan_at = now()` + inserts a `scan_runs(trigger=MANUAL, status=QUEUED)` marker; the worker picks it up. The API never blocks on external sites.

## 2. Module layout

```
src/
├── common/
│   ├── db/            drizzle client, schema re-export (packages? no — schema lives here: src/common/db/schema/*.ts), transaction helper, migrations runner
│   ├── http/          HttpClient (undici): timeouts, retries w/ jitter, per-host token bucket, UA header, redirect capture, max body size
│   ├── logging/       pino logger, request-id middleware, AuditLogger → system_logs
│   ├── errors/        AppError hierarchy, HttpExceptionFilter → envelope
│   ├── pipes/         ZodValidationPipe
│   ├── guards/        SupabaseJwtGuard, AdminGuard, ThrottlerGuard config
│   ├── decorators/    @CurrentUser(), @Public()
│   └── utils/         time, hashing, url
├── auth/              JwksService (cache keys), JwtStrategy, UsersBootstrapService
├── users/             users, profiles, preferences, preferred-roles, skills controllers + services
├── resumes/           ResumesController, ResumesService, parsers/{pdf,docx}.ts, FileStoragePort + SupabaseStorageAdapter, ResumeAnalysisService (→ packages/ai)
├── jobs/              JobsController, JobsService (queries), JobsRepository, CompaniesService, DedupeService, NormalizerService, ClassificationService, TrackerService, JobEventsService
├── sources/           JobSource interface, SourceRegistry (adapter name → class), SourceManager (runs one scan), adapters/{greenhouse,lever,ashby,smartrecruiters,workable,remotive,rss,adzuna,career-page}.ts, SourcesController (admin)
├── scheduler/         SchedulerService (due selection + leases), WorkerLoop (tick loop, signals, --once), PipelineService (stage drains), RecoveryService (stale leases, orphaned runs, gap re-scan), HousekeepingService
├── validation/        ValidationOrchestrator, UrlProbeService, CompanyVerificationService, AvailabilityService, SuspicionService, FresherEligibilityService, ReviewService
├── matching/          MatchingService (deterministic pre-score + AI), PriorityService, JobRequirementsService
├── notifications/     NotificationDispatcher, channels/{telegram,web}.ts, TelegramService (Bot API client + long-poll), TelegramCommandHandler (/start, /status, /pause, /resume, /digest), DigestService, NotificationsController
└── system/            HealthController, StatusService, HeartbeatService, SystemController (logs)
```

Drizzle schema files live in `apps/api/src/common/db/schema/` (they are runtime DB definitions, not shared types). Shared _domain_ types are inferred from Zod in `packages/types`; a small mapper layer converts DB rows ↔ domain objects so the DB schema can change without breaking the API contract.

## 3. Request lifecycle (API)

```
request → RequestIdMiddleware → ThrottlerGuard → SupabaseJwtGuard (verify, bootstrap user)
        → ZodValidationPipe (body/query) → Controller → Service (transaction where needed)
        → response envelope interceptor  |  AppError → HttpExceptionFilter → error envelope + log
```

## 4. Worker loop

```ts
while (!stopping) {
  heartbeat();
  await schedulerService.runDueScans({ maxSources: 3, concurrency: 2 }); // isolated per source
  await pipelineService.drain({ perStageBatch: 25, timeBudgetMs: 60_000 }); // classify → validate → match → notify
  await recheckService.runDue({ batch: 20 }); // closed-job detection
  await notificationDispatcher.flush({ batch: 50 });
  await digestService.sendDueDigests();
  await recoveryService.sweep(); // stale leases, orphan runs
  if (once) break;
  await sleep(jitter(WORKER_TICK_MS /* 60s */));
}
```

- Telegram long-polling runs as a separate async loop in the same process (`TelegramPoller`), guarded by `TELEGRAM_POLLING=true` — disabled in `--once` mode and on GitHub Actions (commands then work via the dashboard only).
- Graceful shutdown on SIGTERM/SIGINT: stop accepting new work, wait ≤ 25 s for in-flight scans, release leases.
- Every loop stage is wrapped so an exception is logged and the loop continues; a repeated crash in the same stage 5× in a row raises a SYSTEM notification.

## 5. Key service contracts

```ts
// sources
interface JobSource {
  readonly adapter: string; // 'greenhouse'
  readonly configSchema: ZodSchema; // validates job_sources.config
  getSourceMetadata(): SourceMetadata; // name, type, docsUrl, defaultPriority, supportsCursor
  validateSource(cfg): Promise<SourceValidation>; // reachable? sample count?
  fetchJobs(cfg, ctx: FetchContext): AsyncIterable<RawJob>; // ctx = { since, cursor, http, logger, limits }
  getLastSuccessfulScan(sourceRow): Date | null;
}

// validation
interface ValidationOrchestrator {
  validate(job: Job, company: Company): Promise<ValidationResult>; // deterministic + evidence + optional AI
}

// ai (packages/ai)
interface AIProvider {
  readonly name: 'gemini' | 'claude' | 'local';
  complete<T>(req: {
    system: string;
    user: string;
    schema: ZodSchema<T>;
    maxTokens;
    temperature;
    purpose;
  }): Promise<AIResult<T>>;
}

// notifications
interface NotificationChannel {
  readonly channel: 'TELEGRAM' | 'WEB';
  send(n: Notification): Promise<SendOutcome>;
}
```

## 6. Transactions & concurrency

- Scan ingestion writes per raw job in its own short transaction (`upsert mapping → find/insert canonical job → job_events`) so one bad record does not roll back the whole scan.
- Pipeline stages select with `FOR UPDATE SKIP LOCKED` and update `status` in the same transaction, making a second worker safe even though we run one.
- `profile_version` bump and re-match enqueue happen in one transaction.

## 7. Configuration

`packages/config` exports `loadEnv()` (Zod). The API and worker call it at boot; missing/invalid variables fail fast with a readable message. `ConfigModule` exposes the typed object via DI; no `process.env` reads outside `packages/config`.

## 8. Logging & audit

- pino JSON logs to stdout (pretty in dev). Fields: `requestId`, `userId` (hashed in prod), `sourceId`, `jobId`, `stage`, `durationMs`.
- `AuditLogger.event(category, message, ctx)` → `system_logs` for business-significant events only (source scan outcome, job status transitions, notifications sent/failed, AI budget exhausted, review decisions). Never log resume text, tokens, or full job descriptions.

## 9. Testing hooks (see doc 13)

- Every external I/O behind an interface with an in-memory fake: `FakeHttpClient` (fixture responses), `FakeAIProvider` (scripted outputs/invalid JSON/errors), `FakeTelegram`, `FakeClock`.
- `TestDb` helper spins a schema in a local Postgres (Docker or Supabase CLI) for integration tests.
