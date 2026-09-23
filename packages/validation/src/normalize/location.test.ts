import { isIndiaLocation, normalizeLocation } from './location';

describe('isIndiaLocation', () => {
  it.each([
    ['Bengaluru, Karnataka, India', true],
    ['Bengaluru', true], // Since normalizeLocation defaults to India for Indian cities
    ['Remote - India', true],
    ['Hyderabad / Remote', true],
    ['New York, NY', false],
    ['London, United Kingdom', false],
    ['Berlin, Germany', false],
    ['Singapore', false],
    ['Remote', false], // bare remote without country
    ['Anywhere', false], // bare anywhere
    [null, false], // no location
  ])('%s → %s', (input, expected) => {
    // Normalize first since isIndiaLocation takes a NormalizedLocation
    const normalized = normalizeLocation(input);
    expect(isIndiaLocation(normalized)).toBe(expected);
  });

  it('rejects ambiguous remote hint from adapter', () => {
    // Adapter says remote=true but no country signal in text
    const normalized = normalizeLocation(null, true);
    expect(isIndiaLocation(normalized)).toBe(false);
  });
});
