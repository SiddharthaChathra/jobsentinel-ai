import type { z } from 'zod';

/** Purposes are fixed so budgets, caching and prompt versions can be tracked per purpose. */
export type AIPurpose =
  | 'RESUME_PROFILE'
  | 'JOB_REQUIREMENTS'
  | 'FRESHER_CLASSIFY'
  | 'MATCH'
  | 'SUSPICION'
  | 'CATEGORY_CLASSIFY';

export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ProviderCompletionRequest {
  system: string;
  user: string;
  /** JSON schema describing the expected output; adapters map it to native structured-output features. */
  jsonSchema: Record<string, unknown>;
  maxOutputTokens: number;
  temperature: number;
}

export interface ProviderCompletionResponse {
  text: string;
  usage: AIUsage;
}

/**
 * The only thing an AI vendor integration has to implement.
 * Adapters must be stateless and must never make business decisions.
 */
export interface AIProvider {
  readonly name: string;
  readonly model: string;
  complete(req: ProviderCompletionRequest): Promise<ProviderCompletionResponse>;
  healthCheck(): Promise<boolean>;
}

export interface AIRequest<T> {
  purpose: AIPurpose;
  promptVersion: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxOutputTokens: number;
  temperature?: number;
  /** Hashed to form the cache key together with purpose + promptVersion. */
  cacheKeyInput: unknown;
  meta?: { jobId?: string; userId?: string };
}

export type AIFailureStatus = 'INVALID_JSON' | 'ERROR' | 'BUDGET_EXCEEDED' | 'UNAVAILABLE';

export type AIResult<T> =
  | {
      status: 'OK';
      data: T;
      provider: string;
      model: string;
      usage: AIUsage;
      latencyMs: number;
      cached: boolean;
    }
  | { status: AIFailureStatus; error: string; provider?: string };
