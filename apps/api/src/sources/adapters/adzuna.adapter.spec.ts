import { AdzunaAdapter, AdzunaConfig } from './adzuna.adapter';
import { STARTER_SOURCES } from '../../common/db/seed/starter-sources';

/**
 * Adzuna's `/search` endpoint has no company filter, and answers HTTP 400 when sent one. Five
 * seeded sources carried `company` and had failed every scan since they were added, so the option
 * is gone and these tests keep it gone (D79).
 */
describe('AdzunaConfig', () => {
  it('rejects a company filter instead of silently ignoring it', () => {
    // Without `.strict()` Zod would strip the unknown key, and the source would quietly widen
    // from one employer to every job in the country.
    const parsed = AdzunaConfig.safeParse({ country: 'in', company: 'HPE', maxDaysOld: 7 });
    expect(parsed.success).toBe(false);
  });

  it('accepts the employer name as a keyword search', () => {
    const parsed = AdzunaConfig.safeParse({ country: 'in', what: 'HPE', maxDaysOld: 7 });
    expect(parsed.success).toBe(true);
  });
});

describe('Adzuna request URL', () => {
  // `url` is private; going through the public shape that builds it keeps the test honest.
  const urlFor = (config: unknown): URL => {
    const adapter = new AdzunaAdapter('test-id', 'test-key');
    const parsed = AdzunaConfig.parse(config);
    const built = (adapter as unknown as { url(c: unknown, page: number): URL }).url(parsed, 1);
    return built;
  };

  it('sends what, country and max_days_old, and never a company parameter', () => {
    const url = urlFor({ country: 'in', what: 'HPE', maxDaysOld: 7 });
    expect(url.pathname).toContain('/jobs/in/search/1');
    expect(url.searchParams.get('what')).toBe('HPE');
    expect(url.searchParams.get('max_days_old')).toBe('7');
    expect(url.searchParams.has('company')).toBe(false);
  });
});

describe('seeded Adzuna sources', () => {
  it('none of them use a company filter the API would reject', () => {
    const adzuna = STARTER_SOURCES.filter((s) => s.adapter === 'adzuna');
    expect(adzuna.length).toBeGreaterThan(0);
    for (const source of adzuna) {
      // Every seeded config must survive the real schema, or the source fails on its first scan.
      expect(AdzunaConfig.safeParse(source.config).success).toBe(true);
    }
  });
});
