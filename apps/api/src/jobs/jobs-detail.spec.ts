import { toEvidenceItems } from './jobs-detail.service';

describe('toEvidenceItems', () => {
  it('maps the engine shape ({ check, passed }) onto the contract shape ({ code })', () => {
    expect(
      toEvidenceItems([
        { check: 'COMPANY_TRUSTED', passed: true, weight: 0.5, detail: 'marked trusted' },
        { check: 'HTTP_STATUS', passed: true, weight: 0.05 },
      ]),
    ).toEqual([
      { code: 'COMPANY_TRUSTED', weight: 0.5, detail: 'marked trusted' },
      { code: 'HTTP_STATUS', weight: 0.05 },
    ]);
  });

  it('accepts rows already stored in the contract shape', () => {
    expect(toEvidenceItems([{ code: 'URL_UNRELATED', weight: -0.25, detail: 'x' }])).toEqual([
      { code: 'URL_UNRELATED', weight: -0.25, detail: 'x' },
    ]);
  });

  it('drops malformed entries instead of rendering blank lines', () => {
    expect(toEvidenceItems([null, 'x', { weight: 1 }, { check: 'A' }])).toEqual([]);
    expect(toEvidenceItems(null)).toEqual([]);
    expect(toEvidenceItems({ check: 'A', weight: 1 })).toEqual([]);
  });
});
