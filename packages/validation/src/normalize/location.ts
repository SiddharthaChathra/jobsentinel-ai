export interface NormalizedLocation {
  text: string | null;
  city: string | null;
  country: string | null;
  isRemote: boolean;
}

/** City → country, with common spellings/aliases. Indian metros first (target audience), then global hubs. */
const CITY_ALIASES: Record<string, { city: string; country: string }> = {
  bengaluru: { city: 'Bengaluru', country: 'India' },
  bangalore: { city: 'Bengaluru', country: 'India' },
  blr: { city: 'Bengaluru', country: 'India' },
  hyderabad: { city: 'Hyderabad', country: 'India' },
  chennai: { city: 'Chennai', country: 'India' },
  madras: { city: 'Chennai', country: 'India' },
  mumbai: { city: 'Mumbai', country: 'India' },
  bombay: { city: 'Mumbai', country: 'India' },
  'navi mumbai': { city: 'Navi Mumbai', country: 'India' },
  pune: { city: 'Pune', country: 'India' },
  delhi: { city: 'Delhi', country: 'India' },
  'new delhi': { city: 'Delhi', country: 'India' },
  gurgaon: { city: 'Gurugram', country: 'India' },
  gurugram: { city: 'Gurugram', country: 'India' },
  noida: { city: 'Noida', country: 'India' },
  ncr: { city: 'Delhi', country: 'India' },
  kolkata: { city: 'Kolkata', country: 'India' },
  calcutta: { city: 'Kolkata', country: 'India' },
  ahmedabad: { city: 'Ahmedabad', country: 'India' },
  jaipur: { city: 'Jaipur', country: 'India' },
  kochi: { city: 'Kochi', country: 'India' },
  cochin: { city: 'Kochi', country: 'India' },
  thiruvananthapuram: { city: 'Thiruvananthapuram', country: 'India' },
  trivandrum: { city: 'Thiruvananthapuram', country: 'India' },
  coimbatore: { city: 'Coimbatore', country: 'India' },
  indore: { city: 'Indore', country: 'India' },
  bhubaneswar: { city: 'Bhubaneswar', country: 'India' },
  chandigarh: { city: 'Chandigarh', country: 'India' },
  mohali: { city: 'Mohali', country: 'India' },
  mysuru: { city: 'Mysuru', country: 'India' },
  mysore: { city: 'Mysuru', country: 'India' },
  mangaluru: { city: 'Mangaluru', country: 'India' },
  mangalore: { city: 'Mangaluru', country: 'India' },
  vadodara: { city: 'Vadodara', country: 'India' },
  surat: { city: 'Surat', country: 'India' },
  nagpur: { city: 'Nagpur', country: 'India' },
  lucknow: { city: 'Lucknow', country: 'India' },
  visakhapatnam: { city: 'Visakhapatnam', country: 'India' },
  vizag: { city: 'Visakhapatnam', country: 'India' },
  london: { city: 'London', country: 'United Kingdom' },
  dublin: { city: 'Dublin', country: 'Ireland' },
  berlin: { city: 'Berlin', country: 'Germany' },
  amsterdam: { city: 'Amsterdam', country: 'Netherlands' },
  paris: { city: 'Paris', country: 'France' },
  singapore: { city: 'Singapore', country: 'Singapore' },
  dubai: { city: 'Dubai', country: 'United Arab Emirates' },
  sydney: { city: 'Sydney', country: 'Australia' },
  toronto: { city: 'Toronto', country: 'Canada' },
  vancouver: { city: 'Vancouver', country: 'Canada' },
  'new york': { city: 'New York', country: 'United States' },
  'san francisco': { city: 'San Francisco', country: 'United States' },
  seattle: { city: 'Seattle', country: 'United States' },
  austin: { city: 'Austin', country: 'United States' },
  boston: { city: 'Boston', country: 'United States' },
  'los angeles': { city: 'Los Angeles', country: 'United States' },
  chicago: { city: 'Chicago', country: 'United States' },
  denver: { city: 'Denver', country: 'United States' },
  tokyo: { city: 'Tokyo', country: 'Japan' },
  'tel aviv': { city: 'Tel Aviv', country: 'Israel' },
};

const COUNTRY_ALIASES: Record<string, string> = {
  india: 'India',
  in: 'India',
  ind: 'India',
  bharat: 'India',
  'united states': 'United States',
  usa: 'United States',
  us: 'United States',
  'u.s.': 'United States',
  'united kingdom': 'United Kingdom',
  uk: 'United Kingdom',
  england: 'United Kingdom',
  germany: 'Germany',
  canada: 'Canada',
  australia: 'Australia',
  singapore: 'Singapore',
  ireland: 'Ireland',
  netherlands: 'Netherlands',
  france: 'France',
  uae: 'United Arab Emirates',
  'united arab emirates': 'United Arab Emirates',
  japan: 'Japan',
  israel: 'Israel',
  poland: 'Poland',
  spain: 'Spain',
  portugal: 'Portugal',
  brazil: 'Brazil',
  mexico: 'Mexico',
  philippines: 'Philippines',
  indonesia: 'Indonesia',
  vietnam: 'Vietnam',
  'south africa': 'South Africa',
  nigeria: 'Nigeria',
  kenya: 'Kenya',
  emea: 'EMEA',
  apac: 'APAC',
  europe: 'Europe',
};

const REMOTE_RE =
  /\b(remote|work from home|wfh|anywhere|distributed|fully remote|remote-first|home based|telecommute)\b/i;

/** Splits "Bengaluru, Karnataka, India | Remote" into normalized city/country and a remote flag. */
export function normalizeLocation(
  raw: string | null | undefined,
  remoteHint?: boolean,
): NormalizedLocation {
  const text = raw?.replace(/\s+/g, ' ').trim() || null;
  const isRemote = Boolean(remoteHint) || (text !== null && REMOTE_RE.test(text));
  if (!text) return { text: null, city: null, country: null, isRemote };

  const parts = text
    .split(/[,|/;•·]|\s+-\s+|\s+\(|\)\s*/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);

  let city: string | null = null;
  let country: string | null = null;
  for (const part of parts) {
    const c = CITY_ALIASES[part];
    if (c && !city) {
      city = c.city;
      country = c.country;
      continue;
    }
    const k = COUNTRY_ALIASES[part];
    if (k && !country) country = k;
  }
  if (!city) {
    // try substrings for cases like "Bengaluru Office" or "Remote - India"
    for (const [alias, c] of Object.entries(CITY_ALIASES)) {
      if (new RegExp(`\\b${alias}\\b`, 'i').test(text)) {
        city = c.city;
        country = country ?? c.country;
        break;
      }
    }
  }
  if (!country) {
    for (const [alias, k] of Object.entries(COUNTRY_ALIASES)) {
      if (alias.length > 2 && new RegExp(`\\b${alias}\\b`, 'i').test(text)) {
        country = k;
        break;
      }
    }
  }
  return { text, city, country, isRemote };
}

/**
 * True only when the country positively resolves to India. Ambiguous "Remote" with no country
 * signal is not India, and neither is a null location — this answers "is it India?", nothing more.
 *
 * Callers must not use it as a standalone gate: "unknown" is not "no". Classification accepts a
 * job that is in India *or* remote *or* has no stated country, and the user-facing narrowing to
 * their preferred locations lives in the job list query, where it can be lifted (D62, D67).
 */
export function isIndiaLocation(loc: NormalizedLocation): boolean {
  if (loc.country === 'India') return true;
  // Everything else — non-India country, null country, ambiguous remote — fails.
  return false;
}
