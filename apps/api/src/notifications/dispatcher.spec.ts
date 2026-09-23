import { isBrokenApplicationStatus } from './dispatcher.service';

describe('isBrokenApplicationStatus', () => {
  it.each([200, 201, 204, 301, 302, 304])('treats %s as a working link', (status) => {
    expect(isBrokenApplicationStatus(status)).toBe(false);
  });

  it.each([
    [403, 'bot-protected board refusing a HEAD it would serve to a browser'],
    [405, 'board that simply does not implement HEAD'],
  ])('does not call %s broken (%s)', (status) => {
    expect(isBrokenApplicationStatus(status)).toBe(false);
  });

  it.each([404, 410, 400, 500, 503])('treats %s as a dead link', (status) => {
    expect(isBrokenApplicationStatus(status)).toBe(true);
  });
});
