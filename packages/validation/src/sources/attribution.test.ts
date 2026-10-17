import { adzunaAttribution } from './attribution';

describe('adzunaAttribution (D115)', () => {
  it('links the word "Adzuna" to the local site of the country searched', () => {
    expect(adzunaAttribution('in')).toEqual({
      provider: 'ADZUNA',
      label: 'Adzuna',
      url: 'https://www.adzuna.in/',
    });
    expect(adzunaAttribution(null).url).toBe('https://www.adzuna.in/'); // the adapter's default
    expect(adzunaAttribution('GB').url).toBe('https://www.adzuna.co.uk/');
    expect(adzunaAttribution('zz').url).toBe('https://www.adzuna.co.uk/'); // terms' fallback
  });
});
