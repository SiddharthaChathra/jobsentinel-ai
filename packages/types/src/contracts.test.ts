import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApiErrorBody } from './api/envelope';
import { SourceReport } from './domain/sources';
import { SourceStatus } from './enums';
import { z } from 'zod';

/**
 * The sample responses handed to the web app (docs/contracts/*.mock.json) must parse with the
 * real schemas, so a contract change that forgets its samples fails here rather than in the UI.
 */
const mock = (name: string) =>
  JSON.parse(readFileSync(resolve(__dirname, '../../../docs/contracts', name), 'utf8')) as Record<
    string,
    { status: number; body: unknown } | Record<string, { status: number; body: unknown }>
  >;

describe('docs/contracts/source-report.mock.json (F2)', () => {
  const m = mock('source-report.mock.json');
  const sample = (key: string) => m[key] as { status: number; body: { data: unknown } };

  it('every report sample parses as SourceReport', () => {
    for (const key of Object.keys(m).filter((k) => k.startsWith('GET /api/v1/sources/report'))) {
      expect(() => SourceReport.parse(sample(key).body.data)).not.toThrow();
    }
  });

  it('covers every health case the UI must render', () => {
    const report = SourceReport.parse(sample('GET /api/v1/sources/report?days=30').body.data);
    expect(new Set(report.sources.map((s) => s.health))).toEqual(
      new Set(['OK', 'PAUSED', 'ERRORS', 'COLLECTED_NOTHING', 'KEPT_ZERO']),
    );
  });

  it('the resume sample and the error samples parse', () => {
    z.object({ id: z.string().uuid(), status: SourceStatus }).parse(
      sample('POST /api/v1/sources/:id/resume').body.data,
    );
    const errors = m.errors as Record<string, { status: number; body: unknown }>;
    for (const e of Object.values(errors)) expect(() => ApiErrorBody.parse(e.body)).not.toThrow();
  });
});
