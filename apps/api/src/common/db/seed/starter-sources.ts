import type { SourcePriority, SourceType } from '@jobsentinel/types';

/**
 * Starter job sources (docs 06 §3). Every ATS board below was verified live on 2026-09-23
 * (public JSON endpoint, ≥ 1 open posting) AND checked by the locations of the postings — slugs are
 * global namespaces: Lever "porter" and Ashby "navi" are unrelated US companies, not the Indian ones. Adapters land in Phase 4; until then the rows just
 * describe what to scan. `company` creates/links a `companies` row with ATS evidence for validation.
 *
 * India-focus policy: global companies are kept only if they have ≥ 5 India-located postings
 * on their board. Sources with 0–2 India jobs are disabled to avoid wasting scan budget.
 * International companies with India offices are fine — the user wants India working locations.
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
  enabled?: boolean,
): StarterSource => ({
  name: `Greenhouse: ${name}`,
  type: 'ATS_API',
  adapter: 'greenhouse',
  config: { boardToken: slug },
  priority,
  company: { name, domain },
  ...(enabled === false ? { enabled: false } : {}),
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
  enabled?: boolean,
): StarterSource => ({
  name: `Ashby: ${name}`,
  type: 'ATS_API',
  adapter: 'ashby',
  config: { jobBoardName: board },
  priority,
  company: { name, domain },
  ...(enabled === false ? { enabled: false } : {}),
});

export const STARTER_SOURCES: StarterSource[] = [
  // ── India-headquartered / strong India hiring — HIGH/NORMAL ──────────────
  gh('groww', 'Groww', 'groww.in', 'HIGH'),
  gh('slice', 'slice', 'sliceit.com', 'HIGH'),
  gh('inmobi', 'InMobi', 'inmobi.com', 'NORMAL'),
  gh('druva', 'Druva', 'druva.com', 'NORMAL'),
  gh('netradyne', 'Netradyne', 'netradyne.com', 'NORMAL'),
  gh('thoughtworks', 'Thoughtworks', 'thoughtworks.com', 'NORMAL'),
  gh('rubrik', 'Rubrik', 'rubrik.com', 'NORMAL'),
  // Razorpay — verified 2026-09-23: 22 jobs, mostly Bengaluru/Mumbai/Chennai
  gh('razorpaysoftwareprivatelimited', 'Razorpay', 'razorpay.com', 'HIGH'),
  lever('cred', 'CRED', 'cred.club', 'HIGH'),
  lever('meesho', 'Meesho', 'meesho.com', 'HIGH'),
  lever('zeta', 'Zeta', 'zeta.tech', 'HIGH'),
  lever('mindtickle', 'Mindtickle', 'mindtickle.com', 'NORMAL'),
  lever('fampay', 'FamPay', 'famapp.in', 'NORMAL'),
  lever('pocketfm', 'Pocket FM', 'pocketfm.com', 'NORMAL'),
  ashby('atlan', 'Atlan', 'atlan.com', 'NORMAL'),

  // ── Global companies with verified India offices (≥5 India postings) ────
  // MongoDB — verified 2026-09-23: 75/401 India jobs (Gurugram, Mumbai)
  gh('mongodb', 'MongoDB', 'mongodb.com', 'NORMAL'),
  // Okta — verified 2026-09-23: 99/328 India jobs (Bengaluru)
  gh('okta', 'Okta', 'okta.com', 'NORMAL'),
  // GitLab — verified 2026-09-23: 25/203 India jobs (Remote India)
  gh('gitlab', 'GitLab', 'gitlab.com', 'NORMAL'),
  // Elastic — verified 2026-09-23: 14/370 India jobs (Hyderabad, Bengaluru)
  gh('elastic', 'Elastic', 'elastic.co', 'LOW'),
  // Twilio — verified 2026-09-23: 13/141 India jobs (Bengaluru, Delhi)
  gh('twilio', 'Twilio', 'twilio.com', 'LOW'),
  // Coinbase — verified 2026-09-23: 11/217 India jobs (Hyderabad)
  gh('coinbase', 'Coinbase', 'coinbase.com', 'LOW'),
  // Datadog — verified 2026-09-23: 9/450 India jobs (Hyderabad, Bengaluru)
  gh('datadog', 'Datadog', 'datadoghq.com', 'LOW'),

  // ── Global companies with few/no India postings — DISABLED ──────────────
  // Cloudflare — 1/391 India jobs, mostly US/EU
  gh('cloudflare', 'Cloudflare', 'cloudflare.com', 'LOW', false),
  // Vercel — 2/89 India jobs, mostly US
  gh('vercel', 'Vercel', 'vercel.com', 'LOW', false),
  // Supabase — 0/56, fully remote US/EU
  ashby('supabase', 'Supabase', 'supabase.com', 'LOW', false),
  // PostHog — 0/8, fully remote US/EU
  ashby('posthog', 'PostHog', 'posthog.com', 'LOW', false),
  // Notion — 4/129, borderline; disabled for now
  ashby('notion', 'Notion', 'notion.so', 'LOW', false),
  // Linear — 0/31
  ashby('linear', 'Linear', 'linear.app', 'LOW', false),
  // Replit — 1/76
  ashby('replit', 'Replit', 'replit.com', 'LOW', false),
  // Zapier — 0/9
  ashby('zapier', 'Zapier', 'zapier.com', 'LOW', false),
  // Resend — 0/11
  ashby('resend', 'Resend', 'resend.com', 'LOW', false),

  // ── Aggregators / feeds ─────────────────────────────────────────────────
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
  // Adzuna India — requires ADZUNA_APP_ID + ADZUNA_APP_KEY env vars
  {
    name: 'Adzuna: India software engineer',
    type: 'PUBLIC_API',
    adapter: 'adzuna',
    config: { country: 'in', what: 'software engineer', maxDaysOld: 7 },
    priority: 'NORMAL',
  },
  {
    name: 'Adzuna: India graduate engineer',
    type: 'PUBLIC_API',
    adapter: 'adzuna',
    config: { country: 'in', what: 'graduate engineer', maxDaysOld: 7 },
    priority: 'LOW',
  },
  // Enterprise ATS Targets via Adzuna
  {
    name: 'Adzuna: Cisco India',
    type: 'PUBLIC_API',
    adapter: 'adzuna',
    config: { country: 'in', company: 'Cisco', maxDaysOld: 7 },
    priority: 'HIGH',
    company: { name: 'Cisco', domain: 'cisco.com' },
  },
  {
    name: 'Adzuna: Cohesity India',
    type: 'PUBLIC_API',
    adapter: 'adzuna',
    config: { country: 'in', company: 'Cohesity', maxDaysOld: 7 },
    priority: 'HIGH',
    company: { name: 'Cohesity', domain: 'cohesity.com' },
  },
  {
    name: 'Adzuna: Nutanix India',
    type: 'PUBLIC_API',
    adapter: 'adzuna',
    config: { country: 'in', company: 'Nutanix', maxDaysOld: 7 },
    priority: 'HIGH',
    company: { name: 'Nutanix', domain: 'nutanix.com' },
  },
  {
    name: 'Adzuna: Juniper India',
    type: 'PUBLIC_API',
    adapter: 'adzuna',
    config: { country: 'in', company: 'Juniper', maxDaysOld: 7 },
    priority: 'HIGH',
    company: { name: 'Juniper Networks', domain: 'juniper.net' },
  },
  {
    name: 'Adzuna: HPE India',
    type: 'PUBLIC_API',
    adapter: 'adzuna',
    config: { country: 'in', company: 'HPE', maxDaysOld: 7 },
    priority: 'HIGH',
    company: { name: 'HPE', domain: 'hpe.com' },
  },
];
