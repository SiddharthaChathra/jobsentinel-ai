import { heldInfo } from './held';

describe('heldInfo (C step 2, D106)', () => {
  it('explains a category hold, with or without an AI answer', () => {
    expect(heldInfo('category unknown', null)).toMatchObject({
      kind: 'CATEGORY_UNKNOWN',
      label: 'Category unclear: the posting does not say what kind of work it is',
    });
    expect(heldInfo('category unknown (no AI verdict)', null).label).toMatch(/not known yet/);
  });

  it('explains an experience hold, alone or with a category hold (R2, D110)', () => {
    expect(heldInfo('experience unknown (no AI verdict)', null)).toMatchObject({
      kind: 'EXPERIENCE_UNKNOWN',
      label: 'Experience not stated: the posting does not say whether freshers can apply',
    });
    expect(heldInfo('experience unknown', null).kind).toBe('EXPERIENCE_UNKNOWN');
    expect(heldInfo('category unknown; experience unknown', null)).toMatchObject({
      kind: 'CATEGORY_UNKNOWN',
      label: expect.stringMatching(/^Category and experience unclear/) as string,
    });
  });

  it('names the job-board case for Adzuna links, the employer case otherwise', () => {
    expect(
      heldInfo('company could not be verified', 'https://www.adzuna.in/details/5925494591'),
    ).toEqual({
      kind: 'COMPANY_UNVERIFIED',
      label: 'Company not verified: the job board links only to its own page, not the employer',
      reason: 'company could not be verified',
    });
    expect(heldInfo('company could not be verified', 'https://jobs.example.com/x').label).toMatch(
      /not on the employer/,
    );
    expect(heldInfo('company could not be verified', 'not a url').kind).toBe('COMPANY_UNVERIFIED');
  });

  it('recognises an unreachable page and falls back for anything else', () => {
    expect(heldInfo('application page could not be reached', null).kind).toBe('URL_UNREACHABLE');
    expect(heldInfo('something new', null)).toEqual({
      kind: 'OTHER',
      label: 'Held for review: something new',
      reason: 'something new',
    });
    expect(heldInfo(null, null).label).toBe('Held for review');
  });
});

describe('docs/contracts/needs-review.mock.json stays true to heldInfo', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mock = require('../../../../docs/contracts/needs-review.mock.json') as Record<
    string,
    { body: { data: { held: { kind: string; label: string; reason: string } }[] } }
  >;
  const cards = mock['GET /api/v1/jobs/needs-review']!.body.data;

  it('covers every held kind', () => {
    expect(new Set(cards.map((c) => c.held.kind))).toEqual(
      new Set([
        'CATEGORY_UNKNOWN',
        'EXPERIENCE_UNKNOWN',
        'COMPANY_UNVERIFIED',
        'URL_UNREACHABLE',
        'OTHER',
      ]),
    );
  });

  it('every label is exactly what heldInfo produces for its reason', () => {
    for (const { held } of cards) {
      const url = held.kind === 'COMPANY_UNVERIFIED' ? 'https://www.adzuna.in/details/1' : null;
      expect(heldInfo(held.reason, url)).toEqual(held);
    }
  });
});
