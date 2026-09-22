import { JobStatus, PriorityBand } from './enums';

describe('enums', () => {
  it('accept known values and reject unknown ones', () => {
    expect(JobStatus.parse('VALID')).toBe('VALID');
    expect(() => JobStatus.parse('valid')).toThrow();
    expect(PriorityBand.options).toEqual(['VERY_HIGH', 'HIGH', 'MEDIUM', 'OTHER']);
  });
});
