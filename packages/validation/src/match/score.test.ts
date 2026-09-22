import {
  applyAiRefinement,
  canonicalSkill,
  priorityFor,
  scoreMatch,
  type MatchJob,
  type MatchProfile,
} from './score';

const profile: MatchProfile = {
  skills: ['Python', 'SQL', 'Linux', 'Networking', 'AWS', 'Docker', 'Git'],
  roles: [
    {
      roleFamily: 'software_engineer',
      normalizedTitle: 'software engineer',
      tier: 'PRIMARY',
      enabled: true,
    },
    {
      roleFamily: 'technical_support_engineer',
      normalizedTitle: 'technical support engineer',
      tier: 'PRIMARY',
      enabled: true,
    },
    {
      roleFamily: 'cloud_engineer',
      normalizedTitle: 'cloud engineer',
      tier: 'SECONDARY',
      enabled: true,
    },
    { roleFamily: 'data_analyst', normalizedTitle: 'data analyst', tier: 'OTHER', enabled: true },
    { roleFamily: 'qa_engineer', normalizedTitle: 'qa engineer', tier: 'PRIMARY', enabled: false },
  ],
  locations: ['Bengaluru', 'Remote'],
  remotePreference: 'ANY',
  employmentTypes: ['FULL_TIME', 'INTERNSHIP'],
  categories: ['SOFTWARE', 'IT_SUPPORT', 'NETWORK', 'CLOUD_DEVOPS', 'DATA'],
  fresherOnly: true,
  graduationYear: 2027,
};

const job = (over: Partial<MatchJob> = {}): MatchJob => ({
  title: 'Software Engineer',
  roleFamily: 'software_engineer',
  category: 'SOFTWARE',
  skills: ['Python', 'SQL'],
  experienceLevel: 'FRESHER',
  fresherEligible: true,
  employmentType: 'FULL_TIME',
  locationCity: 'Bengaluru',
  locationCountry: 'India',
  isRemote: false,
  ...over,
});

describe('canonicalSkill', () => {
  it('resolves aliases to the dictionary name', () => {
    expect(canonicalSkill('postgres')).toBe('PostgreSQL');
    expect(canonicalSkill('  ReactJS ')).toBe('React');
    expect(canonicalSkill('k8s')).toBe('Kubernetes');
    expect(canonicalSkill('Something Bespoke')).toBe('Something Bespoke');
  });
});

describe('scoreMatch', () => {
  it('scores an ideal fresher job near the top band', () => {
    const r = scoreMatch(profile, job());
    expect(r.skillScore).toBe(100);
    expect(r.roleScore).toBe(100);
    expect(r.experienceScore).toBe(100);
    expect(r.locationScore).toBe(100);
    expect(r.overall).toBe(100);
    expect(r.priority).toBe('VERY_HIGH');
    expect(r.matchedSkills).toEqual(['Python', 'SQL']);
    expect(r.explanation).toMatch(/^Match 100% — ✓ Python ✓ SQL/);
  });

  it('weights must-have skills above nice-to-have when the AI extracted requirements', () => {
    const r = scoreMatch(
      profile,
      job({ mustHaveSkills: ['Python', 'Kubernetes'], niceToHaveSkills: ['SQL', 'Terraform'] }),
    );
    // 1 of 2 must-haves (1.0), 1 of 2 nice-to-haves (0.4) out of 2 + 0.8 possible
    expect(r.skillScore).toBe(50);
    expect(r.matchedSkills).toEqual(['Python', 'SQL']);
    expect(r.missingSkills).toContain('Kubernetes');
  });

  it('caps an experienced posting below the MEDIUM band in fresher-only mode', () => {
    // Perfect skills, role and location: without the cap the weighted sum is 80, i.e. HIGH.
    const r = scoreMatch(profile, job({ experienceLevel: 'EXPERIENCED', fresherEligible: false }));
    expect(r.experienceScore).toBe(0);
    expect(r.overall).toBe(45); // capped (D52)
    expect(r.priority).toBe('OTHER');
    expect(r.explanation).toMatch(/✗ Asks for experience/);
  });

  it('keeps a capped job visible and ranked, never deleted (spec principle 9)', () => {
    const senior = scoreMatch(
      profile,
      job({ experienceLevel: 'EXPERIENCED', fresherEligible: false }),
    );
    const seniorAndIrrelevant = scoreMatch(
      profile,
      job({
        experienceLevel: 'EXPERIENCED',
        fresherEligible: false,
        roleFamily: 'mechanical_engineer',
        category: 'MECHANICAL',
        skills: ['AutoCAD'],
      }),
    );
    expect(senior.overall).toBeGreaterThan(0);
    // The cap is a ceiling, not a flattening: worse jobs still rank below.
    expect(seniorAndIrrelevant.overall).toBeLessThan(senior.overall);
  });

  it('applies the experience cap after AI refinement too', () => {
    const base = scoreMatch(
      profile,
      job({ experienceLevel: 'EXPERIENCED', fresherEligible: false }),
    );
    const refined = applyAiRefinement(base, {
      skillScore: 100,
      roleScore: 100,
      matchedSkills: ['Python'],
      missingSkills: [],
      explanation: 'Great technical fit.',
    });
    expect(refined.overall).toBeLessThanOrEqual(45);
    expect(refined.priority).toBe('OTHER');
  });

  it('keeps unknown experience mid-scored rather than punishing it', () => {
    const r = scoreMatch(profile, job({ experienceLevel: 'UNKNOWN', fresherEligible: null }));
    expect(r.experienceScore).toBe(50);
    expect(r.explanation).toMatch(/\? Experience unclear/);
  });

  it('ranks role tiers and ignores disabled roles', () => {
    expect(
      scoreMatch(profile, job({ roleFamily: 'cloud_engineer', category: 'CLOUD_DEVOPS' }))
        .roleScore,
    ).toBe(80);
    expect(
      scoreMatch(profile, job({ roleFamily: 'data_analyst', category: 'DATA' })).roleScore,
    ).toBe(60);
    expect(
      scoreMatch(profile, job({ roleFamily: 'qa_engineer', category: 'SOFTWARE' })).roleScore,
    ).toBe(30); // disabled → category only
    expect(
      scoreMatch(profile, job({ roleFamily: 'mechanical_engineer', category: 'MECHANICAL' }))
        .roleScore,
    ).toBe(10);
  });

  it('scores locations by city, country, remote and mismatch', () => {
    expect(scoreMatch(profile, job()).locationScore).toBe(100);
    // Another city in a country the user did not list is a poor match…
    expect(scoreMatch(profile, job({ locationCity: 'Hyderabad' })).locationScore).toBe(25);
    // …but listing the country explicitly (the default preference) makes it a partial match.
    const countryWide = { ...profile, locations: ['Bengaluru', 'India', 'Remote'] };
    expect(scoreMatch(countryWide, job({ locationCity: 'Hyderabad' })).locationScore).toBe(75);
    expect(
      scoreMatch(countryWide, job({ locationCity: 'Berlin', locationCountry: 'Germany' }))
        .locationScore,
    ).toBe(25);
    expect(
      scoreMatch(profile, job({ isRemote: true, locationCity: null, locationCountry: null }))
        .locationScore,
    ).toBe(100);
    const onsiteOnly = { ...profile, remotePreference: 'ONSITE_ONLY' as const };
    expect(scoreMatch(onsiteOnly, job({ isRemote: true })).locationScore).toBe(40);
  });

  it('treats a posting with no listed skills as neutral, not zero', () => {
    const r = scoreMatch(profile, job({ skills: [] }));
    expect(r.skillScore).toBe(50);
  });

  it('always produces a human-readable explanation with real skill names', () => {
    const r = scoreMatch(profile, job({ skills: ['Python', 'Kubernetes', 'Terraform'] }));
    expect(r.explanation).toContain('✓ Python');
    expect(r.explanation).toContain('✗ Kubernetes');
    expect(r.missingSkills).toEqual(['Kubernetes', 'Terraform']);
  });
});

describe('priorityFor', () => {
  it.each([
    [100, 'VERY_HIGH'],
    [90, 'VERY_HIGH'],
    [89, 'HIGH'],
    [75, 'HIGH'],
    [74, 'MEDIUM'],
    [60, 'MEDIUM'],
    [59, 'OTHER'],
    [0, 'OTHER'],
  ])('%s → %s', (score, band) => {
    expect(priorityFor(score)).toBe(band);
  });
});

describe('applyAiRefinement', () => {
  const base = scoreMatch(profile, job({ skills: ['Python', 'Kubernetes'] }));

  it('lets the AI adjust skill and role scores within ±25', () => {
    const refined = applyAiRefinement(base, {
      skillScore: 80,
      roleScore: 100,
      matchedSkills: ['python'],
      missingSkills: ['kubernetes'],
      explanation: 'Match 80% — strong Python overlap, missing Kubernetes',
    });
    expect(refined.skillScore).toBe(75); // base 50 + 25 cap
    expect(refined.matchedSkills).toEqual(['Python']); // canonicalised
    expect(refined.explanation).toMatch(/strong Python overlap/);
    expect(refined.overall).toBeGreaterThan(base.overall);
  });

  it('cannot rewrite the ranking with an extreme verdict', () => {
    const wild = applyAiRefinement(base, {
      skillScore: 0,
      roleScore: 0,
      matchedSkills: [],
      missingSkills: [],
      explanation: '',
    });
    expect(wild.skillScore).toBe(Math.max(0, base.skillScore - 25));
    expect(wild.roleScore).toBe(Math.max(0, base.roleScore - 25));
    expect(wild.explanation).toBe(base.explanation); // empty explanation falls back to the deterministic one
    const inflated = applyAiRefinement(base, {
      skillScore: 999,
      roleScore: 999,
      matchedSkills: [],
      missingSkills: [],
      explanation: 'x',
    });
    expect(inflated.skillScore).toBeLessThanOrEqual(base.skillScore + 25);
    expect(inflated.roleScore).toBeLessThanOrEqual(100);
  });

  it('never changes experience or location scores', () => {
    const refined = applyAiRefinement(base, {
      skillScore: 100,
      roleScore: 100,
      matchedSkills: [],
      missingSkills: [],
      explanation: 'x',
    });
    expect(refined.experienceScore).toBe(base.experienceScore);
    expect(refined.locationScore).toBe(base.locationScore);
  });
});
