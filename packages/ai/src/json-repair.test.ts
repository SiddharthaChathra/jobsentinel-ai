import { extractJson, parseJsonLoose } from './json-repair';

describe('json repair', () => {
  it('parses clean JSON', () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
  });
  it('strips markdown fences', () => {
    expect(parseJsonLoose('Here you go:\n```json\n{"a": [1,2]}\n```')).toEqual({ a: [1, 2] });
  });
  it('removes surrounding prose and trailing commas', () => {
    expect(parseJsonLoose('Sure! {"a": 1, "b": [1,2,],} Hope this helps')).toEqual({
      a: 1,
      b: [1, 2],
    });
  });
  it('returns undefined for garbage', () => {
    expect(parseJsonLoose('no json here')).toBeUndefined();
    expect(extractJson('}{')).toBeNull();
  });
});
