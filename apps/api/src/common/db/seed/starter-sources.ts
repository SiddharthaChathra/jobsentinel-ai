import type { SourcePriority, SourceType } from '@jobsentinel/types';

/**
 * Starter job sources (docs 06 §3). Every ATS board below was verified live on 2026-09-22
 * (public JSON endpoint, ≥ 1 open posting) AND checked by the locations of the postings — slugs are
 * global namespaces: Lever "porter" and Ashby "navi" are unrelated US companies, not the Indian ones. Adapters land in Phase 4; until then the rows just
 * describe what to scan. `company` creates/links a `companies` row with ATS evidence for validation.
 */
export interface StarterSource {
  name: string;
  type: SourceType;
  adapter: 'greenhouse' | 'lever' | 'ashby' | 'remotive' | 'rss' | 'adzuna';
  config: Record<string, unknown>;
  priority: SourcePriority;
  enabled?: boolean;
  company?: { name: string; domain: string };
}

const gh = (
  slug: string,
  name: string,
  domain: string,
  priority: SourcePriority,
): StarterSource => ({
  name: `Greenhouse: ${name}`,
  type: 'ATS_API',
  adapter: 'greenhouse',
  config: { boardToken: slug },
  priority,
  company: { name, domain },
});
const lever = (
  site: string,
  name: string,
  domain: string,
  priority: SourcePriority,
): StarterSource => ({
  name: `Lever: ${name}`,
  type: 'ATS_API',
  adapter: 'lever',
  config: { site },
  priority,
  company: { name, domain },
});
const ashby = (
  board: string,
  name: string,
  domain: string,
  priority: SourcePriority,
): StarterSource => ({
  name: `Ashby: ${name}`,
  type: 'ATS_API',
  adapter: 'ashby',
  config: { jobBoardName: board },
  priority,
  company: { name, domain },
});

export const STARTER_SOURCES: StarterSource[] = [
  // India-headquartered / strong India hiring — HIGH/NORMAL
  gh('groww', 'Groww', 'groww.in', 'HIGH'),
  gh('slice', 'slice', 'sliceit.com', 'HIGH'),
  gh('inmobi', 'InMobi', 'inmobi.com', 'NORMAL'),
  gh('druva', 'Druva', 'druva.com', 'NORMAL'),
  gh('netradyne', 'Netradyne', 'netradyne.com', 'NORMAL'),
  gh('thoughtworks', 'Thoughtworks', 'thoughtworks.com', 'NORMAL'),
  gh('rubrik', 'Rubrik', 'rubrik.com', 'NORMAL'),
  lever('cred', 'CRED', 'cred.club', 'HIGH'),
  lever('meesho', 'Meesho', 'meesho.com', 'HIGH'),
  lever('zeta', 'Zeta', 'zeta.tech', 'HIGH'),
  lever('mindtickle', 'Mindtickle', 'mindtickle.com', 'NORMAL'),
  lever('fampay', 'FamPay', 'famapp.in', 'NORMAL'),
  lever('pocketfm', 'Pocket FM', 'pocketfm.com', 'NORMAL'),
  ashby('atlan', 'Atlan', 'atlan.com', 'NORMAL'),
  // Global, remote-friendly engineering employers — NORMAL/LOW
  gh('cloudflare', 'Cloudflare', 'cloudflare.com', 'NORMAL'),
  gh('gitlab', 'GitLab', 'gitlab.com', 'NORMAL'),
  gh('mongodb', 'MongoDB', 'mongodb.com', 'NORMAL'),
  gh('elastic', 'Elastic', 'elastic.co', 'LOW'),
  gh('twilio', 'Twilio', 'twilio.com', 'LOW'),
  gh('okta', 'Okta', 'okta.com', 'LOW'),
  gh('datadog', 'Datadog', 'datadoghq.com', 'LOW'),
  gh('coinbase', 'Coinbase', 'coinbase.com', 'LOW'),
  gh('vercel', 'Vercel', 'vercel.com', 'LOW'),
  ashby('supabase', 'Supabase', 'supabase.com', 'NORMAL'),
  ashby('posthog', 'PostHog', 'posthog.com', 'LOW'),
  ashby('notion', 'Notion', 'notion.so', 'LOW'),
  ashby('linear', 'Linear', 'linear.app', 'LOW'),
  ashby('replit', 'Replit', 'replit.com', 'LOW'),
  ashby('zapier', 'Zapier', 'zapier.com', 'LOW'),
  ashby('resend', 'Resend', 'resend.com', 'LOW'),
  // Aggregators / feeds
  {
    name: 'Remotive: software-dev',
    type: 'PUBLIC_API',
    adapter: 'remotive',
    config: { category: 'software-dev' },
    priority: 'LOW',
  },
  {
    name: 'WeWorkRemotely: programming (RSS)',
    type: 'RSS',
    adapter: 'rss',
    config: {
      feedUrl: 'https://weworkremotely.com/categories/remote-programming-jobs.rss',
      companyNameFrom: 'title',
    },
    priority: 'LOW',
  },
  {
    name: 'Adzuna: India graduate engineer',
    type: 'PUBLIC_API',
    adapter: 'adzuna',
    config: { country: 'in', what: 'graduate engineer', maxDaysOld: 7 },
    priority: 'LOW',
    enabled: false, // enable once ADZUNA_APP_ID/KEY are set
  },
];
