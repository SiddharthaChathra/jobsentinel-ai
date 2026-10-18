import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApiErrorBody } from './api/envelope';
import { ApplicationDatesInput, ReminderItem } from './api/reminders';
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

describe('docs/contracts/reminders.mock.json (F5)', () => {
  const m = mock('reminders.mock.json');
  const body = (key: string) => (m[key] as { status: number; body: { data: unknown } }).body;

  it('the list samples parse as ReminderItem[], covering DUE and UPCOMING and a snooze', () => {
    const items = z.array(ReminderItem).parse(body('GET /api/v1/reminders').data);
    expect(new Set(items.map((i) => i.state))).toEqual(new Set(['DUE', 'UPCOMING']));
    expect(items.some((i) => i.snoozedUntil !== null)).toBe(true);
    expect(z.array(ReminderItem).parse(body('GET /api/v1/reminders (empty)').data)).toEqual([]);
  });

  it('the snooze sample parses, and the date-picker request is a valid ApplicationDatesInput', () => {
    ReminderItem.parse(body('POST /api/v1/reminders/:id/snooze').data);
    const dates = m['PATCH /api/v1/applications/:jobId/dates'] as unknown as { request: unknown };
    expect(() => ApplicationDatesInput.parse(dates.request)).not.toThrow();
  });

  it('error samples parse as the error envelope', () => {
    const errors = m.errors as Record<string, { status: number; body: unknown }>;
    for (const e of Object.values(errors)) expect(() => ApiErrorBody.parse(e.body)).not.toThrow();
  });
});
