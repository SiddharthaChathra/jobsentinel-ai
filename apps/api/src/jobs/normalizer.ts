import sanitizeHtml from 'sanitize-html';
import type { EmploymentType, JobCategory } from '@jobsentinel/types';
import {
  classifyRoleFamily,
  cleanUrl,
  computeDedupeKey,
  contentHash,
  extractSkills,
  htmlToText,
  isSameCompany,
  normalizeCompanyName,
  normalizeLocation,
  normalizeTitle,
  parseEmploymentType,
  parseExperience,
  parseSalary,
  simhash,
  simhashToSigned,
} from '@jobsentinel/validation';
import type { RawJob } from '../sources/job-source';

/** One common shape for every discovered job (docs 07 of the spec, docs 06 §5). */
export interface NormalizedJob {
  title: string;
  normalizedTitle: string;
  roleFamily: string;
  category: JobCategory;
  companyName: string;
  normalizedCompany: string;
  companyDomain: string | null;
  description: string;
  descriptionHtml: string | null;
  requirements: string[];
  skills: string[];
  locationText: string | null;
  locationCity: string | null;
  locationCountry: string | null;
  isRemote: boolean;
  employmentType: EmploymentType;
  experienceText: string | null;
  experienceMinYears: number | null;
  experienceMaxYears: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  salaryText: string | null;
  salaryDisclosed: boolean;
  postedAt: Date | null;
  deadline: Date | null;
  sourceUrl: string;
  applicationUrl: string | null;
  dedupeKey: string;
  descriptionSimhash: bigint;
  contentHash: string;
}

const MAX_DESCRIPTION = 20_000;
const REQUIREMENT_HINT =
  /\b(experience|degree|bachelor|b\.?e\b|b\.?tech|m\.?tech|knowledge|proficien|familiar|strong|understanding|ability|must|should|required|preferred|years?|skills?|fluent|hands[- ]on|graduat)/i;

/** sanitize-html allowlist for stored/rendered job HTML (docs 11 §2). */
const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'ul',
    'ol',
    'li',
    'b',
    'strong',
    'i',
    'em',
    'u',
    'h3',
    'h4',
    'h5',
    'a',
    'div',
    'span',
    'table',
    'thead',
    'tbody',
    'tr',
    'td',
    'th',
  ],
  allowedAttributes: { a: ['href'] },
  allowedSchemes: ['http', 'https'],
  transformTags: { h1: 'h3', h2: 'h3', h6: 'h5' },
  exclusiveFilter: (frame) => frame.tag === 'a' && !frame.attribs.href,
};

/** Bullet-ish lines that read like requirements; capped, deduplicated. */
export function extractRequirements(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/^[\s•\-–*·o▪●]+/, '').trim();
    if (line.length < 12 || line.length > 300) continue;
    if (!REQUIREMENT_HINT.test(line)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= 25) break;
  }
  return out;
}

export interface NormalizeOptions {
  /** Company name from the source row when the raw job carries none (single-company sources). */
  fallbackCompanyName?: string | null;
  fallbackCompanyDomain?: string | null;
}

/** Pure: RawJob → NormalizedJob. Never throws on missing optional fields; throws only when title/company/url are unusable. */
export function normalizeRawJob(raw: RawJob, opts: NormalizeOptions = {}): NormalizedJob {
  const title = raw.title.replace(/\s+/g, ' ').trim();
  const companyName = (raw.companyName ?? opts.fallbackCompanyName ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  // The source's domain belongs to the source's company only. A keyword search ("Adzuna: Cisco
  // India") also returns other employers' postings, and lending them cisco.com let company
  // verification "verify" Brillio against Cisco's website (D83).
  const sameAsSource =
    !raw.companyName ||
    (!!opts.fallbackCompanyName && isSameCompany(raw.companyName, opts.fallbackCompanyName));
  const sourceUrl = cleanUrl(raw.sourceUrl);
  if (!title) throw new Error('normalize: empty title');
  if (!companyName) throw new Error('normalize: unknown company');
  if (!sourceUrl) throw new Error(`normalize: unusable source url ${raw.sourceUrl}`);

  // Text only is stored (docs 02): sanitized HTML is derived on demand for the detail page. Storing HTML
  // tripled the bytes per job and made large boards time out over a slow uplink (Phase 4 finding).
  const html = raw.descriptionHtml ? sanitizeHtml(raw.descriptionHtml, SANITIZE) : null;
  const text = (raw.descriptionText?.trim() || htmlToText(html)).slice(0, MAX_DESCRIPTION);
  const location = normalizeLocation(raw.locationText, raw.isRemote);
  const experience = parseExperience(raw.experienceText, title, text.slice(0, 4000));
  const salary = parseSalary(raw.salaryText ?? findSalaryLine(text), {
    countryHint: location.country,
  });
  const role = classifyRoleFamily(title);
  const skills = extractSkills(`${title}\n${text}`).map((s) => s.name);
  const applicationUrl = cleanUrl(raw.applicationUrl, sourceUrl) ?? sourceUrl;

  return {
    title,
    normalizedTitle: normalizeTitle(title),
    roleFamily: role.roleFamily,
    category: role.category,
    companyName,
    normalizedCompany: normalizeCompanyName(companyName),
    companyDomain: raw.companyDomain ?? (sameAsSource ? opts.fallbackCompanyDomain : null) ?? null,
    description: text,
    descriptionHtml: null,
    requirements: extractRequirements(text),
    skills,
    locationText: location.text,
    locationCity: location.city,
    locationCountry: location.country,
    isRemote: location.isRemote,
    employmentType: parseEmploymentType(raw.employmentTypeText, title, ...(raw.departments ?? [])),
    experienceText: experience.text,
    experienceMinYears: experience.minYears,
    experienceMaxYears: experience.maxYears,
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryCurrency: salary.currency,
    salaryPeriod: salary.period,
    salaryText: salary.text,
    salaryDisclosed: salary.text !== null || (salary.min !== null && salary.min > 0),
    postedAt: raw.postedAt ?? raw.updatedAt ?? null,
    deadline: raw.deadline ?? null,
    sourceUrl,
    applicationUrl,
    dedupeKey: computeDedupeKey({
      company: companyName,
      title,
      city: location.city,
      country: location.country,
      isRemote: location.isRemote,
    }),
    descriptionSimhash: simhashToSigned(simhash(text)),
    contentHash: contentHash([title, text, applicationUrl, location.text]),
  };
}

/** First line mentioning a currency/LPA — the salary parser is fed only that, not the whole JD. */
function findSalaryLine(text: string): string | null {
  const m = text.match(/^.*(₹|\$|€|£|\bINR\b|\bUSD\b|\bLPA\b|\blakhs?\b|\bCTC\b|\bsalary\b).*$/im);
  return m ? m[0].slice(0, 200) : null;
}
