import type { SourcePriority, SourceType } from '@jobsentinel/types';
import type { ZodType } from 'zod';
import type { HttpClientPort } from '../common/http/http-client';

/** What an adapter emits: loose, source-shaped, never classified (docs 06 §2). */
export interface RawJob {
  externalId: string;
  title: string;
  companyName?: string;
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
  sourceUrl: string;
  applicationUrl?: string;
  departments?: string[];
  raw?: unknown;
}

export interface FetchContext {
  /** last_successful_scan (minus overlap) or null for a full fetch. Adapters without a time filter ignore it. */
  since: Date | null;
  cursor: string | null;
  http: HttpClientPort;
  log: {
    debug: (msg: string, ctx?: Record<string, unknown>) => void;
    warn: (msg: string, ctx?: Record<string, unknown>) => void;
  };
  /** Safety cap per run. */
  maxItems: number;
  setCursor(next: string | null): void;
}

export interface SourceMetadata {
  adapter: string;
  label: string;
  type: SourceType;
  docsUrl?: string;
  defaultPriority: SourcePriority;
  supportsSince: boolean;
  supportsCursor: boolean;
  /** Minimum gap between requests to this source's host (ms). */
  politenessMs: number;
  /** Lower bound for `scan_interval_sec` a user may configure (respects the source's guidelines). */
  minIntervalSec: number;
}

export interface SourceValidation {
  ok: boolean;
  message: string;
  sampleCount?: number;
}

/** Plugin contract for every job source (docs 06 §2). Adapters must never evade blocks. */
export interface JobSource<C = unknown> {
  readonly metadata: SourceMetadata;
  readonly configSchema: ZodType<C>;
  validateSource(config: C, http: HttpClientPort): Promise<SourceValidation>;
  fetchJobs(config: C, ctx: FetchContext): AsyncIterable<RawJob>;
}

/** Thrown by adapters when the source signals we are not welcome (403/429/challenge). Never retried aggressively. */
export class SourceBlockedError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'SourceBlockedError';
  }
}

export function parseDate(value: unknown): Date | undefined {
  if (typeof value === 'number') return new Date(value < 1e12 ? value * 1000 : value);
  if (typeof value === 'string' && value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}
