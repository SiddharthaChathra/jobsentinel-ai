import {
  computeDedupeKey,
  dedupeTitleKey,
  hammingDistance,
  isPreviewDuplicate,
  simhash,
  simhashFromSigned,
  simhashToSigned,
  titleSimilarity,
} from './dedupe';

describe('dedupeTitleKey', () => {
  it('ignores seniority-noise, batch years and ordering', () => {
    expect(dedupeTitleKey('Software Engineer - Fresher (2026 Batch)')).toBe(
      dedupeTitleKey('software engineer'),
    );
    expect(dedupeTitleKey('Engineer, Software')).toBe(dedupeTitleKey('Software Engineer'));
    expect(dedupeTitleKey('SDE-1 (Urgent Hiring)')).toBe(dedupeTitleKey('SDE 1'));
  });
  it('keeps meaningful differences, including levels', () => {
    expect(dedupeTitleKey('Senior Software Engineer')).not.toBe(
      dedupeTitleKey('Software Engineer'),
    );
    expect(dedupeTitleKey('Software Engineer 1')).not.toBe(dedupeTitleKey('Software Engineer 3'));
    expect(dedupeTitleKey('Software Engineer II')).not.toBe(dedupeTitleKey('Software Engineer'));
    expect(dedupeTitleKey('Data Engineer')).not.toBe(dedupeTitleKey('Data Analyst'));
  });
});

describe('computeDedupeKey', () => {
  const base = {
    company: 'Acme Technologies Pvt Ltd',
    title: 'Software Engineer',
    city: 'Bengaluru',
    country: 'India',
    isRemote: false,
  };
  it('is stable across cosmetic variations', () => {
    const a = computeDedupeKey(base);
    const b = computeDedupeKey({ ...base, company: 'ACME', title: 'Software Engineer (Fresher)' });
    expect(a).toBe(b);
  });
  it('differs by location (same company, similar jobs in two cities stay separate)', () => {
    expect(computeDedupeKey(base)).not.toBe(computeDedupeKey({ ...base, city: 'Hyderabad' }));
  });
});

describe('simhash', () => {
  // A realistic ~150-word JD: SimHash distance scales with the fraction of changed tokens, so
  // the ≤ 6 threshold (docs D21) is calibrated for real postings, not one-liners.
  const jd = `About the role. We are looking for a software engineer fresher with Python, SQL and Linux skills to join our platform team in Bengaluru.
    You will build REST APIs, write unit tests, review pull requests and collaborate with product managers and designers to ship features every sprint.
    Responsibilities include maintaining CI pipelines, monitoring services with dashboards, participating in on-call rotations after onboarding, documenting designs,
    and improving developer tooling. Requirements: a bachelor's degree in computer science or related field graduating in 2026 or 2027, strong fundamentals in
    data structures and algorithms, familiarity with Git, Docker and cloud platforms such as AWS, and good written communication. Nice to have: experience with
    TypeScript, PostgreSQL, Kubernetes or open source contributions. Benefits include health insurance, a learning budget, flexible hours, relocation support and
    an annual offsite. We are an equal opportunity employer and welcome applications from all backgrounds. Apply with your resume and a short note about a project you enjoyed.`;
  it('near-identical texts have small Hamming distance, unrelated texts large', () => {
    const edited = jd
      .replace('Bengaluru', 'Hyderabad')
      .replace('learning budget', 'learning stipend')
      .replace('annual offsite', 'quarterly offsite');
    const other =
      'Mechanical design engineer needed for CAD modelling of automotive components using SolidWorks. Experience with GD&T and manufacturing processes required. Location Pune.';
    expect(hammingDistance(simhash(jd), simhash(edited))).toBeLessThanOrEqual(6);
    expect(hammingDistance(simhash(jd), simhash(other))).toBeGreaterThan(15);
  });
  it('round-trips through signed bigint storage', () => {
    const h = simhash(jd);
    expect(simhashFromSigned(simhashToSigned(h))).toBe(h);
    expect(simhashToSigned(h) < 1n << 63n).toBe(true);
  });
});

describe('titleSimilarity', () => {
  it('scores overlapping titles', () => {
    expect(titleSimilarity('Software Engineer', 'Software Engineer II')).toBeCloseTo(2 / 3);
    expect(titleSimilarity('Backend Software Engineer', 'Software Engineer')).toBeCloseTo(2 / 3);
    expect(titleSimilarity('Data Analyst', 'Network Engineer')).toBe(0);
  });
});

describe('isPreviewDuplicate (F3, D113)', () => {
  const preview = { title: 'Software Engineer - Fresher', city: 'Noida', descriptionLength: 500 };
  const full = { title: 'Software Engineer', city: 'Noida', descriptionLength: 4_200 };

  it('matches a board preview to the full posting of the same job', () => {
    expect(isPreviewDuplicate(preview, full)).toBe(true);
    expect(isPreviewDuplicate(full, preview)).toBe(true);
    expect(isPreviewDuplicate(preview, { ...full, city: null })).toBe(true); // city unknown
  });

  it('never merges different jobs', () => {
    // Two full postings: that is SimHash's call, not this rule's.
    expect(isPreviewDuplicate({ ...preview, descriptionLength: 3_000 }, full)).toBe(false);
    // A level marker is a different job for a fresher.
    expect(isPreviewDuplicate({ ...preview, title: 'Senior Software Engineer' }, full)).toBe(false);
    expect(isPreviewDuplicate({ ...preview, title: 'Software Engineer II' }, full)).toBe(false);
    // Two named cities that differ are two openings.
    expect(isPreviewDuplicate({ ...preview, city: 'Pune' }, full)).toBe(false);
    expect(isPreviewDuplicate({ ...preview, title: 'Data Analyst' }, full)).toBe(false);
  });
});
