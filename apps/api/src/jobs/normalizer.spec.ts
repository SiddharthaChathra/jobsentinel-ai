import { extractRequirements, normalizeRawJob } from './normalizer';

const raw = {
  externalId: '1',
  title: '  Software Engineer   (Fresher) ',
  companyName: 'Acme Technologies Pvt Ltd',
  locationText: 'Bengaluru, Karnataka, India',
  descriptionHtml:
    '<h2>About</h2><p>We build payments.</p><script>evil()</script><a href="javascript:alert(1)">x</a><h3>Requirements</h3><ul><li>B.E./B.Tech in CS, 2026 or 2027 batch</li><li>Strong knowledge of Python and SQL</li><li>Familiarity with Linux and AWS</li></ul><p>Salary: ₹6-8 LPA</p><p>Experience: 0-1 years</p>',
  employmentTypeText: 'Full-time',
  postedAt: new Date('2026-09-20T00:00:00Z'),
  sourceUrl: 'https://boards.greenhouse.io/acme/jobs/1?gh_src=abc',
  applicationUrl: 'https://boards.greenhouse.io/acme/jobs/1?gh_src=abc#app',
};

describe('normalizeRawJob', () => {
  const job = normalizeRawJob(raw);

  it('normalizes title, company, role family and category', () => {
    expect(job.title).toBe('Software Engineer (Fresher)');
    expect(job.normalizedTitle).toBe('software engineer');
    expect(job.normalizedCompany).toBe('acme');
    expect(job.roleFamily).toBe('software_engineer');
    expect(job.category).toBe('SOFTWARE');
  });

  it('extracts location, employment, experience, salary and skills deterministically', () => {
    expect(job).toMatchObject({
      locationCity: 'Bengaluru',
      locationCountry: 'India',
      isRemote: false,
      employmentType: 'FULL_TIME',
    });
    expect(job.experienceMinYears).toBe(0);
    expect(job.experienceMaxYears).toBe(1);
    expect(job).toMatchObject({
      salaryMin: 600_000,
      salaryMax: 800_000,
      salaryCurrency: 'INR',
      salaryPeriod: 'YEAR',
    });
    expect(job.skills).toEqual(expect.arrayContaining(['Python', 'SQL', 'Linux', 'AWS']));
  });

  it('sanitizes HTML, converts to text and pulls requirement bullets', () => {
    expect(job.descriptionHtml).toBeNull(); // HTML is not persisted (size); text is derived from the sanitized HTML
    expect(job.description).toContain('• Strong knowledge of Python and SQL');
    expect(job.requirements).toEqual(
      expect.arrayContaining([
        'Strong knowledge of Python and SQL',
        'Familiarity with Linux and AWS',
      ]),
    );
  });

  it('cleans URLs and produces stable dedupe/content keys', () => {
    expect(job.sourceUrl).toBe('https://boards.greenhouse.io/acme/jobs/1');
    expect(job.applicationUrl).toBe('https://boards.greenhouse.io/acme/jobs/1');
    const again = normalizeRawJob({
      ...raw,
      title: 'Software Engineer - Fresher (2027 batch)',
      companyName: 'ACME',
    });
    expect(again.dedupeKey).toBe(job.dedupeKey);
    expect(again.contentHash).not.toBe(job.contentHash); // title text differs → content changed
    expect(typeof job.descriptionSimhash).toBe('bigint');
  });

  it('falls back to the source company and rejects unusable records', () => {
    const j = normalizeRawJob(
      { ...raw, companyName: undefined },
      { fallbackCompanyName: 'Groww', fallbackCompanyDomain: 'groww.in' },
    );
    expect(j.companyName).toBe('Groww');
    expect(j.companyDomain).toBe('groww.in');
    // A keyword search ("Adzuna: Cisco India") returns other employers' postings; giving them the
    // source's domain verified Brillio as cisco.com.
    const other = normalizeRawJob(
      { ...raw, companyName: 'Brillio' },
      { fallbackCompanyName: 'Cisco', fallbackCompanyDomain: 'cisco.com' },
    );
    expect(other.companyName).toBe('Brillio');
    expect(other.companyDomain).toBeNull();
    const same = normalizeRawJob(
      { ...raw, companyName: 'Cisco Systems' },
      { fallbackCompanyName: 'Cisco', fallbackCompanyDomain: 'cisco.com' },
    );
    expect(same.companyDomain).toBe('cisco.com');
    // The same employer under its full name keeps the domain (Adzuna: HPE India).
    const alias = normalizeRawJob(
      { ...raw, companyName: 'Hewlett Packard Enterprise' },
      { fallbackCompanyName: 'HPE', fallbackCompanyDomain: 'hpe.com' },
    );
    expect(alias.companyDomain).toBe('hpe.com');
    expect(() => normalizeRawJob({ ...raw, companyName: undefined })).toThrow(/unknown company/);
    expect(() => normalizeRawJob({ ...raw, title: '   ' })).toThrow(/empty title/);
    expect(() => normalizeRawJob({ ...raw, sourceUrl: 'javascript:void(0)' })).toThrow(
      /unusable source url/,
    );
  });
});

describe('extractRequirements', () => {
  it('keeps requirement-like bullets only, deduplicated and capped', () => {
    const text = [
      '• Bachelor degree in Engineering',
      '• Bachelor degree in Engineering',
      '- We have a ping pong table',
      'Must have strong SQL skills',
      'ok',
    ].join('\n');
    expect(extractRequirements(text)).toEqual([
      'Bachelor degree in Engineering',
      'Must have strong SQL skills',
    ]);
  });
});
