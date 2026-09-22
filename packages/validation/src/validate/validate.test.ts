import { decideValidation, nextCheckDelayMs, type Evidence } from './decide';
import { domainRelationship, isFreemail, isKnownAtsHost, isShortener, lookalikeOf } from './domain';
import { detectClosedMarkers, detectSuspiciousIndicators, hasApplyForm } from './suspicion';

describe('domainRelationship', () => {
  it('recognises a company ATS board with a matching slug as strong evidence', () => {
    const r = domainRelationship({
      applicationUrl: 'https://boards.greenhouse.io/razorpay/jobs/123',
      companyName: 'Razorpay',
      atsSlug: 'razorpay',
    });
    expect(r).toMatchObject({ relationship: 'KNOWN_ATS', slugMatched: true, weight: 0.3 });
  });

  it('gives an ATS board with an unknown slug weaker credit', () => {
    const r = domainRelationship({
      applicationUrl: 'https://jobs.lever.co/someone-else/1',
      companyName: 'Acme Corp',
      atsSlug: 'acme',
    });
    expect(r).toMatchObject({ relationship: 'KNOWN_ATS', slugMatched: false });
    expect(r.weight).toBeLessThan(0.3);
  });

  it('matches the company domain and its subdomains', () => {
    expect(
      domainRelationship({
        applicationUrl: 'https://acme.com/careers/1',
        companyDomain: 'acme.com',
      }),
    ).toMatchObject({ relationship: 'SAME_DOMAIN', weight: 0.3 });
    expect(
      domainRelationship({
        applicationUrl: 'https://careers.acme.com/job/1',
        companyDomain: 'acme.com',
      }),
    ).toMatchObject({ relationship: 'SUBDOMAIN', weight: 0.3 });
    expect(
      domainRelationship({
        applicationUrl: 'https://careers.acme.com/job/1',
        companyDomain: 'https://www.acme.com',
      }),
    ).toMatchObject({ relationship: 'SUBDOMAIN' });
  });

  it('penalises an unrelated domain and abstains when the company domain is unknown', () => {
    expect(
      domainRelationship({
        applicationUrl: 'https://random-jobs.xyz/apply',
        companyDomain: 'acme.com',
      }),
    ).toMatchObject({ relationship: 'UNRELATED', weight: -0.25 });
    expect(domainRelationship({ applicationUrl: 'https://random-jobs.xyz/apply' })).toMatchObject({
      relationship: 'UNKNOWN',
      weight: 0,
    });
    expect(
      domainRelationship({ applicationUrl: 'not a url', companyDomain: 'acme.com' }),
    ).toMatchObject({ relationship: 'UNKNOWN' });
  });
});

describe('domain helpers', () => {
  it('identifies ATS hosts, shorteners and free mail', () => {
    expect(isKnownAtsHost('https://acme.myworkdayjobs.com/en-US/careers/job/1')).toBe(
      'myworkdayjobs.com',
    );
    expect(isKnownAtsHost('https://careers.acme.com/1')).toBeNull();
    expect(isShortener('https://bit.ly/3abc')).toBe(true);
    expect(isShortener('https://boards.greenhouse.io/x')).toBe(false);
    expect(isFreemail('hr@gmail.com')).toBe(true);
    expect(isFreemail('hr@acme.com')).toBe(false);
  });

  it('detects look-alike domains but not the genuine one', () => {
    expect(lookalikeOf('zeta.tech', ['okta.com'])).toBeNull(); // short brands collide at distance 2
    expect(lookalikeOf('razorpay-careers.com', ['razorpay.com'])).toBe('razorpay.com');
    expect(lookalikeOf('razorpay.net', ['razorpay.com'])).toBe('razorpay.com');
    expect(lookalikeOf('razorpey.com', ['razorpay.com'])).toBe('razorpay.com');
    expect(lookalikeOf('razorpay.com', ['razorpay.com'])).toBeNull();
    expect(lookalikeOf('totallyunrelated.com', ['razorpay.com'])).toBeNull();
  });
});

describe('detectSuspiciousIndicators', () => {
  const base = { title: 'Software Engineer', description: '' };

  it.each([
    ['Pay a registration fee of Rs 500 to confirm your seat.', 'FEE_REQUEST'],
    ['Send the amount to our UPI id acme@okaxis before joining.', 'PAYMENT_APP_MENTION'],
    ['Direct joining, no interview required for this role.', 'NO_INTERVIEW'],
    [
      'Share your Aadhaar and bank account details on WhatsApp to proceed.',
      'SENSITIVE_INFO_REQUEST',
    ],
    ['Earn daily Rs 2000 with a simple copy paste job from home.', 'WORK_FROM_HOME_SCAM'],
    ['Limited seats available, hurry up and apply now before they are gone.', 'URGENCY_PRESSURE'],
    ['A leading MNC is hiring; company name will be disclosed later.', 'GENERIC_COMPANY'],
    ['100% placement guarantee after our training programme.', 'UNREALISTIC_PROMISE'],
  ])('flags %s', (description, code) => {
    const flags = detectSuspiciousIndicators({ ...base, description });
    expect(flags.map((f) => f.code)).toContain(code);
  });

  it('does not fire on legitimate wording that mentions the same words', () => {
    const honest = [
      'We never charge any registration fee at any stage of the hiring process.',
      'No fee is charged by us or our recruiters.',
      'Our interview process has four rounds including a technical test.',
      'We will never ask for your bank details during recruitment.',
    ].join(' ');
    const flags = detectSuspiciousIndicators({ ...base, description: honest });
    expect(flags.filter((f) => f.hard)).toEqual([]);
  });

  it('flags a free-mail contact only when the company has its own domain', () => {
    const withDomain = detectSuspiciousIndicators({
      ...base,
      description: 'Send your CV to hiring@gmail.com',
      companyDomain: 'acme.com',
    });
    expect(withDomain.map((f) => f.code)).toContain('FREEMAIL_CONTACT');
    expect(withDomain.find((f) => f.code === 'FREEMAIL_CONTACT')!.detail).not.toContain(
      'hiring@gmail.com',
    );
    const withoutDomain = detectSuspiciousIndicators({
      ...base,
      description: 'Send your CV to hiring@gmail.com',
    });
    expect(withoutDomain.map((f) => f.code)).not.toContain('FREEMAIL_CONTACT');
  });

  it('flags shortened application links, and implausible pay only for fresher roles', () => {
    const fresher = detectSuspiciousIndicators({
      ...base,
      description: 'Apply now',
      applicationUrl: 'https://bit.ly/3xyz',
      salaryMaxInr: 9_000_000,
      fresherEligible: true,
    });
    expect(fresher.map((f) => f.code)).toEqual(
      expect.arrayContaining(['SHORTENER_IN_CHAIN', 'UNREALISTIC_SALARY']),
    );
    // ₹90 LPA is normal for a principal engineer — the ceiling is a fresher-only sanity check.
    const senior = detectSuspiciousIndicators({
      ...base,
      title: 'Principal Engineer',
      description: 'Apply now',
      salaryMaxInr: 9_000_000,
      fresherEligible: false,
    });
    expect(senior.map((f) => f.code)).not.toContain('UNREALISTIC_SALARY');
  });

  it('returns nothing for an ordinary posting', () => {
    expect(
      detectSuspiciousIndicators({
        title: 'Software Engineer',
        description: 'Build APIs with Python. Bengaluru. 0-1 years.',
      }),
    ).toEqual([]);
  });
});

describe('closed-page detection', () => {
  it.each([
    ['This job is no longer accepting applications.', 'NO_LONGER_ACCEPTING'],
    ['The job you are looking for is no longer open.', 'GREENHOUSE_CLOSED'],
    ['This position has been filled.', 'POSITION_FILLED'],
    ['This posting has expired', 'POSTING_EXPIRED'],
    ['404 page not found', 'NOT_FOUND_TEXT'],
  ])('detects %s', (text, code) => {
    expect(detectClosedMarkers(text).map((m) => m.code)).toContain(code);
  });

  it('does not fire on an open posting', () => {
    expect(
      detectClosedMarkers('Apply now! We are accepting applications on a rolling basis.'),
    ).toEqual([]);
    expect(detectClosedMarkers(null)).toEqual([]);
  });

  it('recognises an application form when present', () => {
    expect(hasApplyForm('<form action="/apply"><input type="file" name="resume"></form>')).toBe(
      true,
    );
    expect(hasApplyForm('<a class="btn">Apply now</a>')).toBe(true);
    expect(hasApplyForm('<p>Some company blurb.</p>')).toBe(false);
  });
});

describe('decideValidation', () => {
  const strongCompany: Evidence[] = [
    { check: 'SOURCE_IS_ATS_BOARD', passed: true, weight: 0.35 },
    { check: 'DOMAIN_RESOLVES', passed: true, weight: 0.1 },
    { check: 'HOMEPAGE_REACHABLE', passed: true, weight: 0.1 },
  ];
  const goodUrl: Evidence[] = [
    { check: 'URL_DOMAIN_RELATIONSHIP', passed: true, weight: 0.3, detail: 'KNOWN_ATS' },
    { check: 'HTTP_OK', passed: true, weight: 0.05 },
  ];

  it('marks a well-evidenced posting VALID', () => {
    const d = decideValidation({
      companyEvidence: strongCompany,
      urlEvidence: goodUrl,
      urlStatus: 'OK',
      suspicionFlags: [],
      closed: false,
      companyBlocked: false,
    });
    expect(d).toMatchObject({
      status: 'VALID',
      companyVerified: true,
      applicationVerified: true,
      jobActive: true,
    });
    expect(d.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('a hard scam flag forces SUSPICIOUS however good the rest looks', () => {
    const d = decideValidation({
      companyEvidence: strongCompany,
      urlEvidence: goodUrl,
      urlStatus: 'OK',
      suspicionFlags: [
        {
          code: 'FEE_REQUEST',
          label: 'Asks the candidate for money',
          detail: 'registration fee',
          weight: -0.6,
          hard: true,
        },
      ],
      closed: false,
      companyBlocked: false,
    });
    expect(d.status).toBe('SUSPICIOUS');
    expect(d.reason).toMatch(/asks the candidate for money/);
  });

  it('closed or missing postings become EXPIRED', () => {
    expect(
      decideValidation({
        companyEvidence: strongCompany,
        urlEvidence: goodUrl,
        urlStatus: 'OK',
        suspicionFlags: [],
        closed: true,
        companyBlocked: false,
      }).status,
    ).toBe('EXPIRED');
    expect(
      decideValidation({
        companyEvidence: strongCompany,
        urlEvidence: [],
        urlStatus: 'NOT_FOUND',
        suspicionFlags: [],
        closed: false,
        companyBlocked: false,
      }),
    ).toMatchObject({ status: 'EXPIRED', jobActive: false });
  });

  it('unverifiable company or unreachable page becomes NEEDS_REVIEW, never VALID', () => {
    const unknownCompany = decideValidation({
      companyEvidence: [{ check: 'NO_DOMAIN_KNOWN', passed: false, weight: -0.1 }],
      urlEvidence: goodUrl,
      urlStatus: 'OK',
      suspicionFlags: [],
      closed: false,
      companyBlocked: false,
    });
    expect(unknownCompany.status).toBe('NEEDS_REVIEW');
    expect(unknownCompany.reason).toMatch(/company could not be verified/);

    const blocked = decideValidation({
      companyEvidence: strongCompany,
      urlEvidence: [],
      urlStatus: 'BLOCKED',
      suspicionFlags: [],
      closed: false,
      companyBlocked: false,
    });
    expect(blocked.status).toBe('NEEDS_REVIEW');
    expect(blocked.applicationVerified).toBe(false);
    expect(blocked.confidence).toBeLessThanOrEqual(0.65); // never report near-certainty next to 'needs review'
  });

  it('bot protection on a verified company own board stays VALID, with the caveat recorded', () => {
    const d = decideValidation({
      companyEvidence: strongCompany,
      urlEvidence: [
        { check: 'URL_DOMAIN_RELATIONSHIP', passed: true, weight: 0.3, detail: 'KNOWN_ATS' },
        { check: 'PAGE_BLOCKED', passed: false, weight: 0 },
      ],
      urlStatus: 'BLOCKED',
      suspicionFlags: [],
      closed: false,
      companyBlocked: false,
    });
    expect(d.status).toBe('VALID');
    expect(d.confidence).toBeLessThanOrEqual(0.8);
    expect(d.reason).toMatch(/refused automated checks/);
    // but a single scam flag removes that benefit of the doubt
    const flagged = decideValidation({
      companyEvidence: strongCompany,
      urlEvidence: [{ check: 'URL_DOMAIN_RELATIONSHIP', passed: true, weight: 0.3 }],
      urlStatus: 'BLOCKED',
      suspicionFlags: [
        {
          code: 'URGENCY_PRESSURE',
          label: 'Artificial urgency',
          detail: 'hurry up',
          weight: -0.15,
          hard: false,
        },
      ],
      closed: false,
      companyBlocked: false,
    });
    expect(flagged.status).toBe('NEEDS_REVIEW');
  });

  it('a blocked company is INVALID', () => {
    expect(
      decideValidation({
        companyEvidence: strongCompany,
        urlEvidence: goodUrl,
        urlStatus: 'OK',
        suspicionFlags: [],
        closed: false,
        companyBlocked: true,
      }).status,
    ).toBe('INVALID');
  });

  it('the AI can nudge but never decide on its own', () => {
    const base = {
      companyEvidence: strongCompany,
      urlEvidence: goodUrl,
      urlStatus: 'OK' as const,
      suspicionFlags: [],
      closed: false,
      companyBlocked: false,
    };
    const withoutAi = decideValidation(base);
    const aiLegit = decideValidation({ ...base, ai: { verdict: 'LEGIT', confidence: 1 } });
    const aiSus = decideValidation({ ...base, ai: { verdict: 'SUSPICIOUS', confidence: 1 } });
    expect(Math.abs(aiLegit.confidence - withoutAi.confidence)).toBeLessThanOrEqual(0.2);
    expect(Math.abs(aiSus.confidence - withoutAi.confidence)).toBeLessThanOrEqual(0.2);
    // A confident "suspicious" cannot flip a strongly evidenced job past SUSPICIOUS on its own.
    expect(aiSus.status).not.toBe('SUSPICIOUS');
    // And a confident "legit" cannot rescue a job with no company evidence.
    const weak = decideValidation({
      companyEvidence: [],
      urlEvidence: [],
      urlStatus: 'ERROR',
      suspicionFlags: [],
      closed: false,
      companyBlocked: false,
      ai: { verdict: 'LEGIT', confidence: 1 },
    });
    expect(weak.status).not.toBe('VALID');
  });

  it('records every contributing signal for the UI', () => {
    const d = decideValidation({
      companyEvidence: strongCompany,
      urlEvidence: goodUrl,
      urlStatus: 'OK',
      suspicionFlags: [
        {
          code: 'URGENCY_PRESSURE',
          label: 'Artificial urgency',
          detail: 'limited seats',
          weight: -0.15,
          hard: false,
        },
      ],
      closed: false,
      companyBlocked: false,
      ai: { verdict: 'LEGIT', confidence: 0.8 },
    });
    expect(d.evidence.map((e) => e.check)).toEqual(
      expect.arrayContaining([
        'SOURCE_IS_ATS_BOARD',
        'URL_DOMAIN_RELATIONSHIP',
        'URGENCY_PRESSURE',
        'AI_ASSESSMENT',
      ]),
    );
  });
});

describe('nextCheckDelayMs', () => {
  it('backs off 6h → 24h → 72h', () => {
    expect(nextCheckDelayMs(0)).toBe(6 * 3600_000);
    expect(nextCheckDelayMs(1)).toBe(24 * 3600_000);
    expect(nextCheckDelayMs(2)).toBe(72 * 3600_000);
    expect(nextCheckDelayMs(9)).toBe(72 * 3600_000);
  });
});
