import { FakeHttpClient, silentLog } from '../../../test/helpers/fake-http';
import type { FetchContext, JobSource, RawJob } from '../job-source';
import { SourceBlockedError } from '../job-source';
import { AshbyAdapter } from './ashby.adapter';
import { GreenhouseAdapter } from './greenhouse.adapter';
import { LeverAdapter } from './lever.adapter';
import { RemotiveAdapter } from './remotive.adapter';
import { RssAdapter } from './rss.adapter';

async function collect<C>(
  adapter: JobSource<C>,
  config: C,
  http: FakeHttpClient,
  maxItems = 100,
): Promise<RawJob[]> {
  const ctx: FetchContext = {
    since: null,
    cursor: null,
    http,
    log: silentLog,
    maxItems,
    setCursor: () => undefined,
  };
  const out: RawJob[] = [];
  for await (const job of adapter.fetchJobs(config, ctx)) out.push(job);
  return out;
}

describe('Greenhouse adapter (recorded fixture)', () => {
  const http = new FakeHttpClient({
    'https://boards-api.greenhouse.io/v1/boards/groww/jobs': {
      file: 'sources/greenhouse-groww.json',
    },
  });
  it('maps jobs, unescapes HTML content and keeps the raw record', async () => {
    const jobs = await collect(new GreenhouseAdapter(), { boardToken: 'groww' }, http);
    expect(jobs).toHaveLength(3);
    const j = jobs[0]!;
    expect(j.externalId).toMatch(/^\d+$/);
    expect(j.sourceUrl).toMatch(/greenhouse\.io\/groww\/jobs\//);
    expect(j.companyName).toBe('Groww');
    expect(j.locationText).toContain('India');
    expect(j.descriptionHtml).toMatch(/^<div>/); // entities unescaped
    expect(j.postedAt).toBeInstanceOf(Date);
    expect(http.requests[0]!.url).toContain('content=true');
  });
  it('validates a board and reports the sample count', async () => {
    await expect(
      new GreenhouseAdapter().validateSource({ boardToken: 'groww' }, http),
    ).resolves.toMatchObject({ ok: true, sampleCount: 3 });
  });
  it('treats 403/429 as blocked, not as retryable', async () => {
    const blocked = new FakeHttpClient({ 'https://boards-api.greenhouse.io/': { status: 429 } });
    await expect(
      collect(new GreenhouseAdapter(), { boardToken: 'x' }, blocked),
    ).rejects.toBeInstanceOf(SourceBlockedError);
  });
  it('respects maxItems', async () => {
    const jobs = await collect(
      new GreenhouseAdapter(),
      { boardToken: 'groww' },
      new FakeHttpClient({
        'https://boards-api.greenhouse.io/': { file: 'sources/greenhouse-groww.json' },
      }),
      2,
    );
    expect(jobs).toHaveLength(2);
  });
});

describe('Lever adapter (recorded fixture)', () => {
  const http = new FakeHttpClient({
    'https://api.lever.co/v0/postings/cred': { file: 'sources/lever-cred.json' },
  });
  it('maps postings with location/country, commitment and ms timestamps', async () => {
    const jobs = await collect(new LeverAdapter(), { site: 'cred' }, http);
    expect(jobs).toHaveLength(3);
    const j = jobs[0]!;
    expect(j.title).toBeTruthy();
    expect(j.sourceUrl).toMatch(/^https:\/\/jobs\.lever\.co\/cred\//);
    expect(j.applicationUrl).toMatch(/\/apply$/);
    expect(j.locationText).toMatch(/IN$/);
    expect(j.employmentTypeText).toBe('full time');
    expect(j.postedAt!.getFullYear()).toBeGreaterThanOrEqual(2024);
  });
  it('rejects a non-array payload', async () => {
    const bad = new FakeHttpClient({ 'https://api.lever.co/': { body: '{"error":"x"}' } });
    await expect(collect(new LeverAdapter(), { site: 'cred' }, bad)).rejects.toThrow(
      /unexpected response/,
    );
  });
});

describe('Ashby adapter (recorded fixture)', () => {
  const http = new FakeHttpClient({
    'https://api.ashbyhq.com/posting-api/job-board/navi': { file: 'sources/ashby-navi.json' },
  });
  it('maps jobs with address-derived location, employment type and remote flag', async () => {
    const jobs = await collect(new AshbyAdapter(), { jobBoardName: 'navi' }, http);
    expect(jobs).toHaveLength(3);
    const j = jobs[0]!;
    expect(j.externalId).toMatch(/^[0-9a-f-]{36}$/);
    expect(j.applicationUrl).toMatch(/\/application$/);
    expect(j.locationText).toContain('United States');
    expect(j.employmentTypeText).toBe('FullTime');
    expect(typeof j.isRemote).toBe('boolean');
  });
});

describe('Remotive adapter (recorded fixture)', () => {
  const http = new FakeHttpClient({
    'https://remotive.com/api/remote-jobs': { file: 'sources/remotive.json' },
  });
  it('maps jobs as remote with company, job type and salary text', async () => {
    const jobs = await collect(
      new RemotiveAdapter(),
      { category: 'software-dev', limit: 200 },
      http,
    );
    expect(jobs).toHaveLength(3);
    const j = jobs[0]!;
    expect(j.isRemote).toBe(true);
    expect(j.companyName).toBeTruthy();
    expect(j.employmentTypeText).toBe('full_time');
    expect(j.raw).not.toHaveProperty('description', expect.stringMatching(/./)); // description not duplicated in raw
    expect(http.requests[0]!.url).toContain('category=software-dev');
  });
});

describe('RSS adapter (recorded WeWorkRemotely fixture)', () => {
  const http = new FakeHttpClient({
    'https://weworkremotely.com/categories/remote-programming-jobs.rss': {
      file: 'sources/wwr-programming.rss',
    },
  });
  it('splits "Company: Title", reads region and marks remote', async () => {
    const jobs = await collect(
      new RssAdapter(),
      {
        feedUrl: 'https://weworkremotely.com/categories/remote-programming-jobs.rss',
        companyNameFrom: 'title',
        titleSeparator: ':',
      },
      http,
    );
    expect(jobs.length).toBeGreaterThanOrEqual(2);
    const j = jobs[0]!;
    expect(j.companyName).toBe('Wonderdog');
    expect(j.title).toBe('Full-Stack Product Engineer - Agentic First');
    expect(j.locationText).toBe('Anywhere in the World');
    expect(j.isRemote).toBe(true);
    expect(j.sourceUrl).toMatch(/^https:\/\/weworkremotely\.com\//);
    expect(j.descriptionHtml).toContain('<p>');
  });
  it('validates feeds and rejects non-feeds', async () => {
    await expect(
      new RssAdapter().validateSource(
        {
          feedUrl: 'https://weworkremotely.com/categories/remote-programming-jobs.rss',
          companyNameFrom: 'title',
          titleSeparator: ':',
        },
        http,
      ),
    ).resolves.toMatchObject({ ok: true });
    const bad = new FakeHttpClient({ 'https://x.example/': { body: '<html>nope</html>' } });
    await expect(
      new RssAdapter().validateSource(
        { feedUrl: 'https://x.example/feed', companyNameFrom: 'title', titleSeparator: ':' },
        bad,
      ),
    ).resolves.toMatchObject({ ok: false });
  });
});
