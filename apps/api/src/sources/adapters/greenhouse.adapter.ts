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

export const GreenhouseConfig = z.object({
  /** Board token as in boards.greenhouse.io/<token>. */
  boardToken: z.string().min(1).max(100),
});
export type GreenhouseConfig = z.infer<typeof GreenhouseConfig>;

interface GhJob {
  id: number;
  title: string;
  absolute_url: string;
  updated_at?: string;
  first_published?: string;
  content?: string;
  location?: { name?: string };
  company_name?: string;
  departments?: { name?: string }[];
  offices?: { name?: string; location?: string }[];
  metadata?: { name?: string; value?: unknown }[];
  application_deadline?: string | null;
}

/** Greenhouse's `content` is HTML with entities escaped once. */
function unescapeHtml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Greenhouse Job Board API — public, documented, no auth
 * (https://developers.greenhouse.io/job-board.html). One request per scan with `content=true`.
 */
export class GreenhouseAdapter implements JobSource<GreenhouseConfig> {
  readonly metadata: SourceMetadata = {
    adapter: 'greenhouse',
    label: 'Greenhouse job board',
    type: 'ATS_API',
    docsUrl: 'https://developers.greenhouse.io/job-board.html',
    defaultPriority: 'NORMAL',
    supportsSince: false,
    supportsCursor: false,
    politenessMs: 1000,
    minIntervalSec: 300,
  };
  readonly configSchema = GreenhouseConfig;

  private url(token: string): string {
    return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`;
  }

  async validateSource(config: GreenhouseConfig, http: HttpClientPort): Promise<SourceValidation> {
    const res = await http.request(this.url(config.boardToken), { retries: 0 });
    if (res.status === 404) return { ok: false, message: `Board "${config.boardToken}" not found` };
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    const data = JSON.parse(res.text) as { jobs?: unknown[] };
    return { ok: true, message: 'ok', sampleCount: data.jobs?.length ?? 0 };
  }

  async *fetchJobs(config: GreenhouseConfig, ctx: FetchContext): AsyncIterable<RawJob> {
    const res = await ctx.http.request(this.url(config.boardToken));
    if (res.truncated)
      throw new Error(
        `greenhouse: response exceeded the body size cap (${res.text.length} bytes read)`,
      );
    if (res.status === 403 || res.status === 429)
      throw new SourceBlockedError(`greenhouse ${res.status}`, res.status);
    if (!res.ok) throw new Error(`greenhouse HTTP ${res.status}`);
    const data = JSON.parse(res.text) as { jobs?: GhJob[] };
    let n = 0;
    for (const job of data.jobs ?? []) {
      if (n++ >= ctx.maxItems) break;
      if (!job.id || !job.title || !job.absolute_url) {
        ctx.log.warn('greenhouse: skipping malformed job', { id: job.id });
        continue;
      }
      const html = job.content ? unescapeHtml(job.content) : undefined;
      const location =
        job.location?.name ??
        job.offices
          ?.map((o) => o.name)
          .filter(Boolean)
          .join(', ');
      yield {
        externalId: String(job.id),
        title: job.title,
        companyName: job.company_name,
        locationText: location,
        descriptionHtml: html,
        postedAt: parseDate(job.first_published),
        updatedAt: parseDate(job.updated_at),
        deadline: parseDate(job.application_deadline),
        sourceUrl: job.absolute_url,
        applicationUrl: job.absolute_url,
        departments: job.departments?.map((d) => d.name ?? '').filter(Boolean),
        raw: { ...job, content: undefined },
      };
    }
  }
}
