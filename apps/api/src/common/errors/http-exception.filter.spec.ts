import { formatUnexpected } from './http-exception.filter';

describe('formatUnexpected', () => {
  it('keeps the stack of a plain error', () => {
    const err = new Error('boom');
    expect(formatUnexpected(err)).toContain('boom');
  });

  it('appends the cause chain with each postgres error code', () => {
    // What drizzle actually throws: the SQL on the outside, the reason underneath.
    const socket = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    const driver = Object.assign(new Error('write CONNECT_TIMEOUT'), {
      code: 'CONNECT_TIMEOUT',
      cause: socket,
    });
    const query = Object.assign(new Error('Failed query: select 1'), { cause: driver });

    const out = formatUnexpected(query);
    expect(out).toContain('Failed query: select 1');
    expect(out).toContain('caused by [CONNECT_TIMEOUT]: ');
    expect(out).toContain('caused by [ECONNRESET]: ');
  });

  it('stops after four causes rather than following a cycle forever', () => {
    const a = new Error('a');
    const b = new Error('b');
    (a as { cause?: unknown }).cause = b;
    (b as { cause?: unknown }).cause = a;

    const out = formatUnexpected(a);
    expect(out.split('caused by')).toHaveLength(5); // the error itself plus four causes
  });

  it('survives a thrown non-error', () => {
    expect(formatUnexpected('just a string')).toBe('just a string');
    expect(formatUnexpected(undefined)).toBe('undefined');
  });
});
