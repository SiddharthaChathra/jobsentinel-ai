import { normalizeCompanyName } from './company';
import { cleanUrl, htmlToText, parseEmploymentType, parseExperience, parseSalary } from './fields';
import { normalizeLocation } from './location';

describe('normalizeCompanyName', () => {
  it.each([
    ['Razorpay Software Pvt. Ltd.', 'razorpay'],
    ['CRED', 'cred'],
    ['Thoughtworks Technologies (India) Private Limited', 'thoughtworks'],
    ['Zoho Corporation', 'zoho'],
    ['Procter & Gamble', 'procter and gamble'],
    ['Société Générale', 'societe generale'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeCompanyName(input)).toBe(expected);
  });
});

describe('normalizeLocation', () => {
  it.each([
    ['Bengaluru, Karnataka, India', 'Bengaluru', 'India', false],
    ['Bangalore', 'Bengaluru', 'India', false],
    ['Remote - India', null, 'India', true],
    ['Hyderabad / Remote', 'Hyderabad', 'India', true],
    ['Gurgaon, IN', 'Gurugram', 'India', false],
    ['London, United Kingdom', 'London', 'United Kingdom', false],
    ['Anywhere', null, null, true],
    ['New York, NY', 'New York', 'United States', false],
  ])('%s → %s / %s / remote=%s', (input, city, country, remote) => {
    const r = normalizeLocation(input);
    expect(r.city).toBe(city);
    expect(r.country).toBe(country);
    expect(r.isRemote).toBe(remote);
  });
  it('honours the adapter remote hint and handles empty input', () => {
    expect(normalizeLocation('Pune', true).isRemote).toBe(true);
    expect(normalizeLocation(null)).toEqual({
      text: null,
      city: null,
      country: null,
      isRemote: false,
    });
  });
});

describe('parseEmploymentType', () => {
  it.each([
    ['Software Engineer Intern', 'INTERNSHIP'],
    ['Graduate Engineer Trainee', 'TRAINEE'],
    ['Full-time', 'FULL_TIME'],
    ['Contract (6 months)', 'CONTRACT'],
    ['Part time support', 'PART_TIME'],
    ['', 'UNKNOWN'],
  ])('%s → %s', (input, expected) => {
    expect(parseEmploymentType(input)).toBe(expected);
  });
});

describe('parseExperience', () => {
  it.each([
    ['0-2 years of experience', 0, 2],
    ['0 to 1 year', 0, 1],
    ['3+ yrs', 3, null],
    ['Minimum 5 years', 5, null],
    ['up to 2 years', 0, 2],
    ['2 years of relevant experience', 2, 2],
    ['Freshers welcome', 0, 0],
    ['No experience required', 0, 0],
    ['We ship every 2 weeks', null, null],
  ])('%s → [%s, %s]', (input, min, max) => {
    const r = parseExperience(input);
    expect(r.minYears).toBe(min);
    expect(r.maxYears).toBe(max);
  });
});

describe('parseSalary', () => {
  it('parses Indian LPA ranges', () => {
    expect(parseSalary('₹6 - 8 LPA')).toMatchObject({
      min: 600_000,
      max: 800_000,
      currency: 'INR',
      period: 'YEAR',
    });
    expect(parseSalary('6 to 8 lakhs per annum')).toMatchObject({
      min: 600_000,
      max: 800_000,
      currency: 'INR',
      period: 'YEAR',
    });
    expect(parseSalary('CTC 4.5 LPA')).toMatchObject({
      min: 450_000,
      max: 450_000,
      currency: 'INR',
    });
  });
  it('parses USD ranges with separators and monthly amounts', () => {
    expect(parseSalary('$80,000 - $100,000 / year')).toMatchObject({
      min: 80_000,
      max: 100_000,
      currency: 'USD',
      period: 'YEAR',
    });
    expect(parseSalary('25k per month', { countryHint: 'India' })).toMatchObject({
      min: 25_000,
      max: 25_000,
      currency: 'INR',
      period: 'MONTH',
      currencyInferred: true,
    });
  });
  it('never invents a salary', () => {
    expect(parseSalary('Competitive salary').min).toBeNull();
    expect(parseSalary(null).min).toBeNull();
  });
});

describe('cleanUrl', () => {
  it('strips tracking params, hash, trailing slash; rejects non-http', () => {
    expect(
      cleanUrl('https://Jobs.Lever.co/acme/123/?lever-source=LinkedIn&utm_medium=x#apply'),
    ).toBe('https://jobs.lever.co/acme/123');
    expect(cleanUrl('/jobs/1', 'https://boards.greenhouse.io/acme')).toBe(
      'https://boards.greenhouse.io/jobs/1',
    );
    expect(cleanUrl('https://www.netradyne.com/careers?gh_jid=4570&gh_src=xyz')).toBe(
      'https://www.netradyne.com/careers?gh_jid=4570',
    ); // embedded-board job id kept
    expect(cleanUrl('mailto:hr@acme.com')).toBeNull();
    expect(cleanUrl('not a url')).toBeNull();
  });
});

describe('htmlToText', () => {
  it('turns blocks into lines, lists into bullets, decodes entities, drops scripts', () => {
    const out = htmlToText(
      '<script>x()</script><h2>Role</h2><p>Build &amp; ship</p><ul><li>Python</li><li>SQL &#8211; basics</li></ul>',
    );
    expect(out).toBe('Role\nBuild & ship\n• Python\n• SQL – basics');
  });
});
