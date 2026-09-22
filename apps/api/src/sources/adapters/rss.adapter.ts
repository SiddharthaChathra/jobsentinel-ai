import Parser from 'rss-parser';
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

export const RssConfig = z.object({
  feedUrl: z.url(),
  /** Where the company name lives: "Company: Title" in the item title, the item author/creator, or a fixed value. */
  companyNameFrom: z.enum(['title', 'author', 'fixed']).default('title'),
  fixedCompany: z.string().max(120).optional(),
  /** Separator between company and title when `companyNameFrom = 'title'`. */
  titleSeparator: z.string().max(5).default(':'),
});
export type RssConfig = z.infer<typeof RssConfig>;

type Item = {
  guid?: string;
  link?: string;
  title?: string;
  creator?: string;
  author?: string;
  isoDate?: string;
  pubDate?: string;
  content?: string;
  contentSnippet?: string;
  region?: string;
  categories?: string[];
};

/**
 * Generic RSS/Atom adapter for public job feeds (e.g. WeWorkRemotely categories).
 * Feeds carry no time filter, so every scan reads the whole feed; dedupe makes that cheap.
 */
export class RssAdapter implements JobSource<RssConfig> {
  readonly metadata: SourceMetadata = {
    adapter: 'rss',
    label: 'RSS / Atom job feed',
    type: 'RSS',
    defaultPriority: 'LOW',
    supportsSince: false,
    supportsCursor: false,
    politenessMs: 5000,
    minIntervalSec: 1800,
  };
  readonly configSchema = RssConfig;
  private readonly parser = new Parser<unknown, Item>({
    customFields: { item: ['region'] },
    timeout: 15_000,
  });

  async validateSource(config: RssConfig, http: HttpClientPort): Promise<SourceValidation> {
    const res = await http.request(config.feedUrl, { retries: 0 });
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    try {
      const feed = await this.parser.parseString(res.text);
      return { ok: true, message: feed.title ?? 'ok', sampleCount: feed.items.length };
    } catch (err) {
      return {
        ok: false,
        message: `Not a valid feed: ${err instanceof Error ? err.message : 'parse error'}`,
      };
    }
  }

  async *fetchJobs(config: RssConfig, ctx: FetchContext): AsyncIterable<RawJob> {
    const res = await ctx.http.request(config.feedUrl);
    if (res.truncated)
      throw new Error(`rss: response exceeded the body size cap (${res.text.length} bytes read)`);
    if (res.status === 403 || res.status === 429)
      throw new SourceBlockedError(`rss ${res.status}`, res.status);
    if (!res.ok) throw new Error(`rss HTTP ${res.status}`);
    const feed = await this.parser.parseString(res.text);
    let n = 0;
    for (const item of feed.items) {
      if (n++ >= ctx.maxItems) break;
      const link = item.link?.trim();
      const rawTitle = item.title?.trim();
      if (!link || !rawTitle) continue;
      let company: string | undefined;
      let title = rawTitle;
      if (config.companyNameFrom === 'title') {
        const idx = rawTitle.indexOf(config.titleSeparator);
        if (idx > 0) {
          company = rawTitle.slice(0, idx).trim();
          title = rawTitle.slice(idx + config.titleSeparator.length).trim() || rawTitle;
        }
      } else if (config.companyNameFrom === 'author') {
        company = item.creator ?? item.author;
      } else {
        company = config.fixedCompany;
      }
      yield {
        externalId: item.guid?.trim() || link,
        title,
        companyName: company,
        locationText: item.region,
        isRemote: /remote|anywhere/i.test(
          `${item.region ?? ''} ${feed.title ?? ''} ${config.feedUrl}`,
        ),
        descriptionHtml: item.content,
        postedAt: parseDate(item.isoDate ?? item.pubDate),
        sourceUrl: link,
        applicationUrl: link,
        departments: item.categories,
        raw: { guid: item.guid, title: rawTitle, region: item.region, categories: item.categories },
      };
    }
  }
}
