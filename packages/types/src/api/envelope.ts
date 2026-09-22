import { z } from 'zod';

/** Standard API response envelope — docs/architecture/03-api-contract.md §1 */
export const ApiErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

export const PageMeta = z.object({
  nextCursor: z.string().nullable().optional(),
  total: z.number().int().nonnegative().optional(),
});
export type PageMeta = z.infer<typeof PageMeta>;

export interface ApiSuccess<T> {
  data: T;
  meta?: PageMeta & Record<string, unknown>;
}

export const HealthResponse = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptimeSec: z.number().nonnegative(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const ReadinessResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.record(z.string(), z.enum(['ok', 'fail', 'skipped'])),
});
export type ReadinessResponse = z.infer<typeof ReadinessResponse>;
