import { isSameCompany, normalizeCompanyName } from './company';

describe('isSameCompany', () => {
  it.each([
    ['Cisco', 'Cisco Systems India Pvt Ltd'],
    ['HPE', 'Hewlett Packard Enterprise'],
    ['Rubrik', 'Rubrik Job Board'],
    ['Juniper Networks', 'Juniper Networks India'],
  ])('%s is %s', (a, b) => {
    expect(isSameCompany(a, b)).toBe(true);
    expect(isSameCompany(b, a)).toBe(true);
  });

  // Real postings returned by the single-employer keyword searches (D83).
  it.each([
    ['Cisco', 'Brillio'],
    ['Juniper Networks', 'Juniper Square'],
    ['Cohesity', 'Amazon'],
    ['HPE', 'Extreme Networks'],
    ['Nutanix', 'NTT America'],
    ['', 'Anything'],
  ])('%s is not %s', (a, b) => {
    expect(isSameCompany(a, b)).toBe(false);
    expect(isSameCompany(b, a)).toBe(false);
  });

  it('does not treat a short fragment as a prefix match', () => {
    expect(isSameCompany('AB', 'AB Testing Co')).toBe(false);
  });
});

describe('normalizeCompanyName: a board names itself, not the company (D128)', () => {
  it.each([
    ['HackerRank Careers', 'hackerrank'],
    ['Rubrik Job Board', 'rubrik'],
    ['Acme Jobs', 'acme'],
    ['Acme Hiring', 'acme'],
    ['Acme Careers Page', 'acme'],
    ['HackerRank', 'hackerrank'],
  ])('%s → %s', (name, key) => {
    expect(normalizeCompanyName(name)).toBe(key);
  });

  it.each([
    ['Careers360', 'careers360'],
    ['Jobs for Her', 'jobs for her'],
    ['Careers', 'careers'], // a bare suffix stays itself rather than becoming empty
  ])('only a trailing board word is dropped: %s → %s', (name, key) => {
    expect(normalizeCompanyName(name)).toBe(key);
  });
});
