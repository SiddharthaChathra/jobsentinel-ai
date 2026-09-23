import { isOperationalError } from './process-guards';

describe('isOperationalError (D66)', () => {
  it('treats socket and pooler failures as transient', () => {
    for (const code of ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'CONNECT_TIMEOUT', 'ENOTFOUND']) {
      expect(isOperationalError(Object.assign(new Error('boom'), { code }))).toBe(true);
    }
    expect(isOperationalError(new Error('read ECONNRESET'))).toBe(true);
    expect(isOperationalError(new Error('Connection terminated unexpectedly'))).toBe(true);
  });

  it('does not treat a programming error as transient', () => {
    expect(isOperationalError(new TypeError('x is not a function'))).toBe(false);
    expect(isOperationalError(new Error('Zod validation failed'))).toBe(false);
    expect(isOperationalError(undefined)).toBe(false);
    expect(isOperationalError(null)).toBe(false);
    expect(isOperationalError('a string')).toBe(false);
  });
});
