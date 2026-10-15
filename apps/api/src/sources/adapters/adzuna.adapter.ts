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

export const AdzunaConfig = z
  .object({
    country: z.string().min(2).max(2).default('in'),
    /**
     * Adzuna's `/search` endpoint has no company filter — a `company` parameter makes it answer
     * HTTP 400 outright, with or without a `what` alongside it (verified against the live API).
     * Five seeded "Enterprise ATS" sources carried one and had failed every scan since they were
     * added. To follow one employer, put its name in `what`: that is a keyword match over the
     * posting rather than a true company filter, and the validation stage verifies the employer
     * independently (D79). `.strict()` below makes a stray `company` fail loudly instead of being
     * silently stripped, which would quietly widen the search to every job in the country.
     */
    what: z.string().optional(),
    where: z.string().optional(),
    maxDaysOld: z.number().optional(),
    /**
     * Pages to walk per scan, 50 jobs each. Adzuna's free tier allows ~250 requests a DAY across
     * every query, and a broad search like "software engineer" in India matches 28 000+ postings —
     * without this bound one scan would spend 20 requests and a handful of scans would exhaust the
     * day's quota (D63). Two pages of the newest results is plenty at an hourly cadence.
     */
    maxPages: z.number().int().min(1).max(10).default(2),
  })
  .strict();
export type AdzunaConfig = z.infer<typeof AdzunaConfig>;

/**
 * HttpClient defaults to preferring HTML (it mostly probes job pages). Adzuna content-negotiates
 * on that and answers a 200 with its marketing page, so this endpoint must ask for JSON (D65).
 */
const JSON_ONLY = { Accept: 'application/json' };

interface AdzunaJob {
  id: string | number;
  title: string;
  description?: string;
  redirect_url: string;
  created?: string;
  company?: { display_name?: string };
  /** `area` runs country → region → city → locality, e.g. `['India', 'Maharashtra', 'Kolhapur']`. */
  location?: { display_name?: string; area?: string[] };
  contract_type?: string;
  category?: { tag?: string };
}

export class AdzunaAdapter implements JobSource<AdzunaConfig> {
  readonly metadata: SourceMetadata = {
    adapter: 'adzuna',
    label: 'Adzuna Jobs API',
    type: 'PUBLIC_API',
    docsUrl: 'https://developer.adzuna.com/docs/search',
    defaultPriority: 'LOW',
    supportsSince: false,
    supportsCursor: false,
    politenessMs: 1000,
    // 250 requests/day across ALL queries: 7 sources x 4 scans x 2 pages = 56/day (D63).
    minIntervalSec: 21_600,
  };
  readonly configSchema = AdzunaConfig;

  constructor(
    private readonly appId: string | undefined,
    private readonly appKey: string | undefined,
  ) {}

  private url(config: AdzunaConfig, page: number): URL {
    const url = new URL(`https://api.adzuna.com/v1/api/jobs/${config.country}/search/${page}`);
    url.searchParams.set('app_id', this.appId ?? '');
    url.searchParams.set('app_key', this.appKey ?? '');
    url.searchParams.set('results_per_page', '50');
    if (config.what) url.searchParams.set('what', config.what);
    if (config.where) url.searchParams.set('where', config.where);
    if (config.maxDaysOld) url.searchParams.set('max_days_old', String(config.maxDaysOld));
    return url;
  }

  async validateSource(config: AdzunaConfig, http: HttpClientPort): Promise<SourceValidation> {
    if (!this.appId || !this.appKey) {
      return { ok: false, message: 'ADZUNA_APP_ID and ADZUNA_APP_KEY must be set in .env' };
    }
    const res = await http.request(this.url(config, 1).toString(), {
      retries: 0,
      headers: JSON_ONLY,
    });
    if (res.status === 401 || res.status === 403)
      return { ok: false, message: 'Invalid Adzuna API credentials' };
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    const data = parseAdzunaJson<{ count?: number }>(res.text, res.status);
    return { ok: true, message: 'ok', sampleCount: data.count ?? 0 };
  }

  async *fetchJobs(config: AdzunaConfig, ctx: FetchContext): AsyncIterable<RawJob> {
    if (!this.appId || !this.appKey) {
      ctx.log.warn('adzuna: disabled due to missing ADZUNA_APP_ID / ADZUNA_APP_KEY in env');
      return;
    }

    let page = 1;
    let n = 0;
    while (true) {
      const res = await ctx.http.request(this.url(config, page).toString(), { headers: JSON_ONLY });
      if (res.truncated)
        throw new Error(
          `adzuna: response exceeded the body size cap (${res.text.length} bytes read)`,
        );
      if (res.status === 403 || res.status === 429)
        throw new SourceBlockedError(`adzuna ${res.status}`, res.status);
      if (!res.ok) throw new Error(`adzuna HTTP ${res.status}`);

      const data = parseAdzunaJson<{ results?: AdzunaJob[] }>(res.text, res.status);
      const jobs = data.results ?? [];
      if (jobs.length === 0) break;

      for (const job of jobs) {
        if (n++ >= ctx.maxItems) return;

        yield {
          externalId: String(job.id),
          title: job.title,
          companyName: job.company?.display_name,
          locationText: adzunaLocationText(job.location),
          descriptionText: job.description,
          postedAt: parseDate(job.created),
          sourceUrl: job.redirect_url,
          applicationUrl: job.redirect_url,
          employmentTypeText: job.contract_type,
          departments: job.category?.tag ? [job.category.tag] : [],
          raw: job,
        };
      }

      if (jobs.length < 50 || page >= config.maxPages) break;
      page++;
    }
  }
}

/**
 * Adzuna's `display_name` names only the town ("Chandgad, Kolhapur"), which the normalizer cannot
 * place in a country, and the India-only gate drops a job whose country is unknown (D73) — so
 * fresher postings from small towns were being filtered out of an India board. The country is in
 * `area[0]`; appending it when the display name does not already carry it lets the normalizer
 * resolve the location without a list of every town in the country.
 */
export function adzunaLocationText(location: AdzunaJob['location']): string | undefined {
  const name = location?.display_name?.trim();
  const country = location?.area?.[0]?.trim();
  if (!country) return name || undefined;
  if (!name) return country;
  return name.toLowerCase().includes(country.toLowerCase()) ? name : `${name}, ${country}`;
}

/**
 * Adzuna answers a 503 with an HTML maintenance page, and a CDN in front of it can do the same
 * on a 200. `JSON.parse` would then surface an opaque `Unexpected token '<'`, which says nothing
 * about which source failed or why — this reports the status instead (D63).
 */
function parseAdzunaJson<T>(text: string, status: number): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const looksLikeHtml = /^\s*<(!doctype|html)/i.test(text);
    throw new Error(
      looksLikeHtml
        ? `adzuna returned an HTML page instead of JSON (HTTP ${status}) — the API is likely rate-limited or down`
        : `adzuna returned an unparseable body (HTTP ${status})`,
    );
  }
}
