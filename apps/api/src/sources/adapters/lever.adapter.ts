import { z } from 'zod';
import type { HttpClientPort } from '../../common/http/http-client';
import {
  parseDate,
  SourceBlockedError,
  type FetchContext,
  type JobSource,
  type RawJob,
  type SourceMetadata,
  type SourceValidation,
} from '../job-source';

export const LeverConfig = z.object({
  /** Site slug as in jobs.lever.co/<site>. */
  site: z.string().min(1).max(100),
});
export type LeverConfig = z.infer<typeof LeverConfig>;

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt?: number;
  updatedAt?: number;
  country?: string;
  workplaceType?: string;
  categories?: {
    commitment?: string;
    department?: string;
    location?: string;
    team?: string;
    allLocations?: string[];
  };
  descriptionPlain?: string;
  description?: string;
  descriptionBodyPlain?: string;
  lists?: { text?: string; content?: string }[];
  additionalPlain?: string;
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
}

/** Lever Postings API — public, documented (https://github.com/lever/postings-api). */
export class LeverAdapter implements JobSource<LeverConfig> {
  readonly metadata: SourceMetadata = {
    adapter: 'lever',
    label: 'Lever postings',
    type: 'ATS_API',
    docsUrl: 'https://github.com/lever/postings-api',
    defaultPriority: 'NORMAL',
    supportsSince: false,
    supportsCursor: false,
    politenessMs: 1000,
    minIntervalSec: 300,
  };
  readonly configSchema = LeverConfig;

  private url(site: string): string {
    return `https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`;
  }

  async validateSource(config: LeverConfig, http: HttpClientPort): Promise<SourceValidation> {
    const res = await http.request(this.url(config.site), { retries: 0 });
    if (res.status === 404) return { ok: false, message: `Site "${config.site}" not found` };
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    const data = JSON.parse(res.text) as unknown;
    return {
      ok: Array.isArray(data),
      message: Array.isArray(data) ? 'ok' : 'unexpected response',
      sampleCount: Array.isArray(data) ? data.length : 0,
    };
  }

  async *fetchJobs(config: LeverConfig, ctx: FetchContext): AsyncIterable<RawJob> {
    const res = await ctx.http.request(this.url(config.site));
    if (res.truncated)
      throw new Error(`lever: response exceeded the body size cap (${res.text.length} bytes read)`);
    if (res.status === 403 || res.status === 429)
      throw new SourceBlockedError(`lever ${res.status}`, res.status);
    if (!res.ok) throw new Error(`lever HTTP ${res.status}`);
    const data = JSON.parse(res.text) as LeverPosting[];
    if (!Array.isArray(data)) throw new Error('lever: unexpected response shape');
    let n = 0;
    for (const p of data) {
      if (n++ >= ctx.maxItems) break;
      if (!p.id || !p.text || !p.hostedUrl) {
        ctx.log.warn('lever: skipping malformed posting', { id: p.id });
        continue;
      }
      const lists = (p.lists ?? []).map((l) => `${l.text ?? ''}\n${l.content ?? ''}`).join('\n');
      const html = [
        p.description ?? '',
        lists,
        p.additionalPlain ? `<p>${p.additionalPlain}</p>` : '',
      ]
        .filter(Boolean)
        .join('\n');
      const locations = p.categories?.allLocations?.length
        ? p.categories.allLocations.join(', ')
        : p.categories?.location;
      const location = [locations, p.country].filter(Boolean).join(', ');
      const salary = p.salaryRange?.min
        ? `${p.salaryRange.currency ?? ''} ${p.salaryRange.min} - ${p.salaryRange.max ?? p.salaryRange.min} ${p.salaryRange.interval ?? ''}`.trim()
        : undefined;
      yield {
        externalId: p.id,
        title: p.text,
        locationText: location || undefined,
        isRemote: p.workplaceType?.toLowerCase() === 'remote',
        descriptionHtml: html || undefined,
        descriptionText: p.descriptionPlain,
        employmentTypeText: p.categories?.commitment,
        salaryText: salary,
        postedAt: parseDate(p.createdAt),
        updatedAt: parseDate(p.updatedAt),
        sourceUrl: p.hostedUrl,
        applicationUrl: p.applyUrl ?? p.hostedUrl,
        departments: [p.categories?.department, p.categories?.team].filter((x): x is string =>
          Boolean(x),
        ),
        raw: {
          ...p,
          description: undefined,
          descriptionPlain: undefined,
          descriptionBody: undefined,
          descriptionBodyPlain: undefined,
          lists: undefined,
          additional: undefined,
          additionalPlain: undefined,
          opening: undefined,
          openingPlain: undefined,
        },
      };
    }
  }
}
