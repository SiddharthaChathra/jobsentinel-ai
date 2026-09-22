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

export const RemotiveConfig = z.object({
  category: z.string().min(1).max(60).optional(),
  search: z.string().min(1).max(100).optional(),
  limit: z.number().int().min(1).max(500).default(200),
});
export type RemotiveConfig = z.infer<typeof RemotiveConfig>;

interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name?: string;
  category?: string;
  tags?: string[];
  job_type?: string;
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
}

/**
 * Remotive public API (https://remotive.com/api/remote-jobs). Their guideline asks for a low
 * request rate, hence the LOW default priority and a 1-hour minimum interval.
 */
export class RemotiveAdapter implements JobSource<RemotiveConfig> {
  readonly metadata: SourceMetadata = {
    adapter: 'remotive',
    label: 'Remotive remote jobs API',
    type: 'PUBLIC_API',
    docsUrl: 'https://github.com/remotive-com/remote-jobs-api',
    defaultPriority: 'LOW',
    supportsSince: false,
    supportsCursor: false,
    politenessMs: 5000,
    minIntervalSec: 3600,
  };
  readonly configSchema = RemotiveConfig;

  private url(config: RemotiveConfig): string {
    const u = new URL('https://remotive.com/api/remote-jobs');
    if (config.category) u.searchParams.set('category', config.category);
    if (config.search) u.searchParams.set('search', config.search);
    u.searchParams.set('limit', String(config.limit));
    return u.toString();
  }

  async validateSource(config: RemotiveConfig, http: HttpClientPort): Promise<SourceValidation> {
    const res = await http.request(this.url({ ...config, limit: 1 }), { retries: 0 });
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    const data = JSON.parse(res.text) as { 'job-count'?: number };
    return { ok: true, message: 'ok', sampleCount: data['job-count'] ?? 0 };
  }

  async *fetchJobs(config: RemotiveConfig, ctx: FetchContext): AsyncIterable<RawJob> {
    const res = await ctx.http.request(this.url(config));
    if (res.truncated)
      throw new Error(
        `remotive: response exceeded the body size cap (${res.text.length} bytes read)`,
      );
    if (res.status === 403 || res.status === 429)
      throw new SourceBlockedError(`remotive ${res.status}`, res.status);
    if (!res.ok) throw new Error(`remotive HTTP ${res.status}`);
    const data = JSON.parse(res.text) as { jobs?: RemotiveJob[] };
    let n = 0;
    for (const job of data.jobs ?? []) {
      if (n++ >= ctx.maxItems) break;
      if (!job.id || !job.title || !job.url) continue;
      yield {
        externalId: String(job.id),
        title: job.title,
        companyName: job.company_name,
        locationText: job.candidate_required_location,
        isRemote: true,
        descriptionHtml: job.description,
        employmentTypeText: job.job_type,
        salaryText: job.salary || undefined,
        postedAt: parseDate(job.publication_date),
        sourceUrl: job.url,
        applicationUrl: job.url,
        departments: job.category ? [job.category] : undefined,
        raw: { ...job, description: undefined },
      };
    }
  }
}
