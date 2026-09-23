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

describe('Indian states resolve a country when the city is unknown', () => {
  // Fresher hiring is concentrated in tier-2/tier-3 cities that will never all be in CITY_ALIASES.
  // "Raipur, Chhattisgarh" was a real SOFTWARE graduate-trainee posting dropped as foreign (D73).
  it.each([
    ['Raipur, Chhattisgarh', 'India'],
    ['Bhopal, Madhya Pradesh', 'India'],
    ['Guwahati, Assam', 'India'],
    ['Kochi, Kerala', 'India'],
    ['Tiruchirappalli, Tamil Nadu', 'India'],
    ['Remote - Rajasthan', 'India'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeLocation(input).country).toBe(expected);
    expect(isIndiaLocation(normalizeLocation(input))).toBe(true);
  });

  it('does not let a state name override an explicit foreign country', () => {
    // "Georgia" is a US state and a country; our list has neither, but the guard matters for
    // anything we add later — an explicit country in the text always wins.
    expect(normalizeLocation('Punjab, Pakistan').country).toBe('Pakistan');
  });

  it('still returns no country for a foreign city we do not know', () => {
    expect(normalizeLocation('Skopje').country).toBeNull();
    expect(isIndiaLocation(normalizeLocation('Skopje'))).toBe(false);
  });
});
