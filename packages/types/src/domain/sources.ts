import { z } from 'zod';
import { ScanStatus, ScanTrigger, SourcePriority, SourceStatus, SourceType } from '../enums';

export const SourceSummary = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: SourceType,
  adapter: z.string(),
  config: z.record(z.string(), z.unknown()),
  company: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  enabled: z.boolean(),
  priority: SourcePriority,
  scanIntervalSec: z.number().int().nullable(),
  status: SourceStatus,
  nextScanAt: z.string().nullable(),
  lastAttemptedScan: z.string().nullable(),
  lastSuccessfulScan: z.string().nullable(),
  lastError: z.string().nullable(),
  consecutiveFailures: z.number().int(),
  leased: z.boolean(),
  manualRequested: z.boolean(),
  jobsCount: z.number().int(),
});
export type SourceSummary = z.infer<typeof SourceSummary>;

export const SourceInput = z.object({
  name: z.string().min(3).max(120),
  adapter: z.string().min(1).max(40),
  config: z.record(z.string(), z.unknown()),
  priority: SourcePriority.default('NORMAL'),
  scanIntervalSec: z
    .number()
    .int()
    .min(60)
    .max(7 * 24 * 3600)
    .nullable()
    .optional(),
  companyId: z.string().uuid().nullable().optional(),
  enabled: z.boolean().default(true),
});
export type SourceInput = z.infer<typeof SourceInput>;

export const SourcePatch = z.object({
  enabled: z.boolean().optional(),
  priority: SourcePriority.optional(),
  scanIntervalSec: z
    .number()
    .int()
    .min(60)
    .max(7 * 24 * 3600)
    .nullable()
    .optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type SourcePatch = z.infer<typeof SourcePatch>;

export const ScanRun = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
  sourceName: z.string().optional(),
  trigger: ScanTrigger,
  status: ScanStatus,
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  jobsFound: z.number().int(),
  jobsNew: z.number().int(),
  jobsUpdated: z.number().int(),
  jobsSkipped: z.number().int(),
  requestsMade: z.number().int(),
  durationMs: z.number().int().nullable(),
  errorMessage: z.string().nullable(),
});
export type ScanRun = z.infer<typeof ScanRun>;

export const SourceValidationResult = z.object({
  ok: z.boolean(),
  message: z.string(),
  sampleCount: z.number().int().optional(),
});
export type SourceValidationResult = z.infer<typeof SourceValidationResult>;

export const AdapterInfo = z.object({
  adapter: z.string(),
  label: z.string(),
  type: SourceType,
  docsUrl: z.string().optional(),
  defaultPriority: SourcePriority,
  minIntervalSec: z.number().int(),
  configSchema: z.record(z.string(), z.unknown()),
});
export type AdapterInfo = z.infer<typeof AdapterInfo>;

/** docs/architecture/03-api-contract.md §4 */
export const SystemStatus = z.object({
  worker: z.object({
    alive: z.boolean(),
    lastBeatAt: z.string().nullable(),
    hostname: z.string().nullable(),
    version: z.string().nullable(),
    currentTask: z.string().nullable(),
  }),
  sources: z.object({
    total: z.number().int(),
    active: z.number().int(),
    degraded: z.number().int(),
    failing: z.number().int(),
    disabled: z.number().int(),
    nextScanAt: z.string().nullable(),
  }),
  lastScans: z.array(ScanRun),
  pipeline: z.record(z.string(), z.number().int()),
  jobsLast24h: z.object({ found: z.number().int(), new: z.number().int() }),
  totals: z.object({ jobs: z.number().int(), companies: z.number().int() }),
  /** Today AI usage against the daily caps (docs 09 §6). */
  ai: z.object({
    callsToday: z.number().int(),
    callBudget: z.number().int(),
    tokensToday: z.number().int(),
    tokenBudget: z.number().int(),
  }),
});
export type SystemStatus = z.infer<typeof SystemStatus>;
