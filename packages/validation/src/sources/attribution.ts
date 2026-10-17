import type { SourceAttribution } from '@jobsentinel/types';

/**
 * Adzuna's local sites, per the country code its API is queried with. Their terms require the
 * word "Adzuna" on every displayed advert, linked to adzuna.co.uk "or the relevant local domain"
 * (developer.adzuna.com/docs/terms_of_service, read 2026-10-18; D115).
 */
const ADZUNA_DOMAINS: Record<string, string> = {
  in: 'www.adzuna.in',
  gb: 'www.adzuna.co.uk',
  us: 'www.adzuna.com',
  au: 'www.adzuna.com.au',
  ca: 'www.adzuna.ca',
  sg: 'www.adzuna.sg',
};

export function adzunaAttribution(country: string | null | undefined): SourceAttribution {
  const host = ADZUNA_DOMAINS[(country ?? 'in').toLowerCase()] ?? 'www.adzuna.co.uk';
  return { provider: 'ADZUNA', label: 'Adzuna', url: `https://${host}/` };
}
