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
    // Ashby's employmentType "Intern" (Sarvam AI) types the job even when the title does not.
    ['Intern AI Research Engineer', 'INTERNSHIP'],
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

  // D116: real postings from production, as the description (third hint) carries them.
  const fromBody = (body: string) => parseExperience(null, 'Software Engineer', body);

  it.each([
    'About Kennametal With over 80 years as an industrial technology leader, Kennametal delivers…',
    'It has been more than 60 years since SYSTRA has garnered expertise that spans…',
    'For 30+ years, we’ve delivered extraordinary impact together with our clients…',
    'ERM is the largest specialist consultancy, with over 50 years of experience helping organisations…',
    'With 40 years of experience in the Insurtech game, we’re now…',
    'For 10+ years, we have been building tools for developers.',
    'For 12 years, we’ve built payment rails for banks.', // curly apostrophe, under the cap
    'We operate in 80+ countries.',
    'This role is 80% remote.',
    'Minimum 20 years of experience in banking.', // above the cap: a parse error, not a requirement
  ])('company history and other numbers are not a requirement: %s', (body) => {
    expect(fromBody(body)).toEqual({ minYears: null, maxYears: null, text: null });
  });

  it('skips company history and finds the real requirement after it', () => {
    expect(
      fromBody(
        'For 30+ years, we’ve delivered impact. You have 0-2 years of experience with Java.',
      ),
    ).toMatchObject({ minYears: 0, maxYears: 2 });
    expect(fromBody('We need 3+ years in Java.')).toMatchObject({ minYears: 3 });
    expect(fromBody('Experience: 2-4 years')).toMatchObject({ minYears: 2, maxYears: 4 });
    expect(fromBody('At least 5 years of hands-on work.')).toMatchObject({ minYears: 5 });
  });

  // D126 (audit defect 1): "N+ years", ranges and "minimum N years" are experience on their own;
  // only an implausible figure or a non-experience context rejects them.
  it.each([
    ['Freshers welcome, 3+ years preferred. Java.', 3, null],
    ['3+ years desirable.', 3, null],
    ['Ideally 4+ yrs with Go.', 4, null],
    ['minimum 2 years', 2, null],
    ['0-1 years', 0, 1],
    // A degree mentioned just before a real requirement does not hide it (production postings).
    [
      "You hold a Bachelor's degree and have 2-4 years of relevant accounts payable experience",
      2,
      4,
    ],
    ["Bachelor's degree and 3-5 years of experience in Sales Operations", 3, 5],
  ])(
    'a figure reads as experience without the words "experience" or "required": %s',
    (body, min, max) => {
      expect(fromBody(body)).toMatchObject({ minYears: min, maxYears: max });
    },
  );

  it.each([
    'We operate in 80+ countries.',
    'This role is 80% remote.',
    'A 4+ year degree in Computer Science (B.Tech) is required.',
    'Pursuing a B.Tech, 4+ years programme.',
    'Founded 10+ years ago in Pune.',
    'We have grown 5x over the past 3+ years.',
    'The product carries a 2+ year warranty.',
  ])('a figure about something other than experience is not a requirement: %s', (body) => {
    expect(fromBody(body).minYears).toBeNull();
  });

  it("trusts the source's own experience field without extra wording", () => {
    expect(parseExperience('2-4 years', 'Engineer', '')).toMatchObject({
      minYears: 2,
      maxYears: 4,
    });
    // …but still applies the cap there.
    expect(parseExperience('30+ years', 'Engineer', '').minYears).toBeNull();
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

describe('parseSalary — figures that are not pay (D60)', () => {
  it('ignores a 401(k) benefit line', () => {
    for (const text of ['401(k) matching', '401k plan with company match', '403(b) retirement']) {
      expect(parseSalary(text).min).toBeNull();
    }
  });

  it('ignores a bare small number with no period to make it plausible', () => {
    expect(parseSalary('Team of 5 engineers').min).toBeNull();
    expect(parseSalary('1').min).toBeNull();
    expect(parseSalary('Top 2% of applicants').min).toBeNull();
  });

  it('still accepts a genuine hourly or monthly rate', () => {
    expect(parseSalary('$22 per hour')).toMatchObject({ min: 22, period: 'HOUR', currency: 'USD' });
    expect(parseSalary('₹25,000 per month')).toMatchObject({ min: 25_000, period: 'MONTH' });
  });

  it('still accepts the normal cases', () => {
    expect(parseSalary('₹6-10 LPA')).toMatchObject({
      min: 600_000,
      max: 1_000_000,
      currency: 'INR',
    });
    expect(parseSalary('$120,000 - $150,000 a year')).toMatchObject({
      min: 120_000,
      max: 150_000,
      currency: 'USD',
      period: 'YEAR',
    });
  });
});

describe('parseSalary — figures in the millions are not pay (D60)', () => {
  it('ignores funding and revenue numbers', () => {
    expect(parseSalary('We raised $20 million to $50 million in Series C').min).toBeNull();
    expect(parseSalary('backed by $15–20M in funding').min).toBeNull();
  });

  it('still accepts a large but real CTC in rupees', () => {
    expect(parseSalary('₹18 LPA', { countryHint: 'India' })).toMatchObject({ min: 1_800_000 });
  });
});
