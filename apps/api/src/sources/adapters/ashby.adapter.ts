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

export const AshbyConfig = z.object({
  /** Board name as in jobs.ashbyhq.com/<name>. */
  jobBoardName: z.string().min(1).max(100),
});
export type AshbyConfig = z.infer<typeof AshbyConfig>;

interface AshbyJob {
  id: string;
  title: string;
  jobUrl: string;
  applyUrl?: string;
  publishedAt?: string;
  isListed?: boolean;
  isRemote?: boolean;
  location?: string;
  secondaryLocations?: { location?: string }[];
  address?: {
    postalAddress?: { addressLocality?: string; addressRegion?: string; addressCountry?: string };
  };
  employmentType?: string;
  workplaceType?: string;
  department?: string;
  team?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  compensation?: {
    compensationTierSummary?: string | null;
    scrapeableCompensationSalarySummary?: string | null;
  };
}

/** Ashby public job posting API — documented, no auth (https://developers.ashbyhq.com/docs/public-job-posting-api). */
export class AshbyAdapter implements JobSource<AshbyConfig> {
  readonly metadata: SourceMetadata = {
    adapter: 'ashby',
    label: 'Ashby job board',
    type: 'ATS_API',
    docsUrl: 'https://developers.ashbyhq.com/docs/public-job-posting-api',
    defaultPriority: 'NORMAL',
    supportsSince: false,
    supportsCursor: false,
    politenessMs: 1000,
    minIntervalSec: 300,
  };
  readonly configSchema = AshbyConfig;

  private url(board: string): string {
    return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`;
  }

  async validateSource(config: AshbyConfig, http: HttpClientPort): Promise<SourceValidation> {
    const res = await http.request(this.url(config.jobBoardName), { retries: 0 });
    if (res.status === 404)
      return { ok: false, message: `Board "${config.jobBoardName}" not found` };
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    const data = JSON.parse(res.text) as { jobs?: unknown[] };
    return { ok: true, message: 'ok', sampleCount: data.jobs?.length ?? 0 };
  }

  async *fetchJobs(config: AshbyConfig, ctx: FetchContext): AsyncIterable<RawJob> {
    const res = await ctx.http.request(this.url(config.jobBoardName));
    if (res.truncated)
      throw new Error(`ashby: response exceeded the body size cap (${res.text.length} bytes read)`);
    if (res.status === 403 || res.status === 429)
      throw new SourceBlockedError(`ashby ${res.status}`, res.status);
    if (!res.ok) throw new Error(`ashby HTTP ${res.status}`);
    const data = JSON.parse(res.text) as { jobs?: AshbyJob[] };
    let n = 0;
    for (const job of data.jobs ?? []) {
      if (n++ >= ctx.maxItems) break;
      if (job.isListed === false) continue;
      if (!job.id || !job.title || !job.jobUrl) {
        ctx.log.warn('ashby: skipping malformed job', { id: job.id });
        continue;
      }
      const addr = job.address?.postalAddress;
      const primary =
        job.location ??
        [addr?.addressLocality, addr?.addressRegion, addr?.addressCountry]
          .filter(Boolean)
          .join(', ');
      const secondary = (job.secondaryLocations ?? []).map((s) => s.location).filter(Boolean);
      const location = [primary, ...secondary].filter(Boolean).join(' | ');
      const country = addr?.addressCountry;
      yield {
        externalId: job.id,
        title: job.title,
        locationText:
          country && !location.includes(country)
            ? `${location}, ${country}`
            : location || undefined,
        isRemote: job.isRemote === true || job.workplaceType?.toLowerCase() === 'remote',
        descriptionHtml: job.descriptionHtml,
        descriptionText: job.descriptionPlain,
        employmentTypeText: job.employmentType,
        salaryText:
          job.compensation?.scrapeableCompensationSalarySummary ??
          job.compensation?.compensationTierSummary ??
          undefined,
        postedAt: parseDate(job.publishedAt),
        sourceUrl: job.jobUrl,
        applicationUrl: job.applyUrl ?? job.jobUrl,
        departments: [job.department, job.team].filter((x): x is string => Boolean(x)),
        raw: { ...job, descriptionHtml: undefined, descriptionPlain: undefined },
      };
    }
  }
}
