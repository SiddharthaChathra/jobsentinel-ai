import { z } from 'zod';
import { ApplicationStatus, ReminderKind, ReminderStatus } from '../enums';

/**
 * Tracker reminders (F5, D119; docs/architecture/03-api-contract.md §Reminders).
 *
 * `GET /reminders` — the user's reminders that need attention: DUE (sent or overdue, not
 * dismissed) and UPCOMING (pending, due within `withinDays`).
 */
export const RemindersQuery = z.object({
  withinDays: z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : Number(v)),
    z.number().int().min(1).max(60).optional(),
  ),
});
export type RemindersQuery = z.infer<typeof RemindersQuery>;

export const ReminderItem = z.object({
  id: z.uuid(),
  kind: ReminderKind,
  status: ReminderStatus,
  /** DUE: sent, or due and waiting for quiet hours to end. UPCOMING: scheduled. */
  state: z.enum(['DUE', 'UPCOMING']),
  /** When it fires (or fired): its scheduled time, or the snooze time when snoozed. */
  dueAt: z.iso.datetime(),
  snoozedUntil: z.iso.datetime().nullable(),
  sentAt: z.iso.datetime().nullable(),
  /** Plain-language line, e.g. "Follow up on SDE I at Hevo: no update for 7 days since you applied." */
  message: z.string(),
  job: z.object({
    id: z.uuid(),
    title: z.string(),
    company: z.string(),
    applicationStatus: ApplicationStatus.nullable(),
  }),
});
export type ReminderItem = z.infer<typeof ReminderItem>;

/** `POST /reminders/:id/snooze` — remind again later (1 hour to 7 days; default 24 hours). */
export const ReminderSnoozeInput = z.object({
  hours: z.number().int().min(1).max(168).optional(),
});
export type ReminderSnoozeInput = z.infer<typeof ReminderSnoozeInput>;

/**
 * `PATCH /applications/:jobId/dates` — the tracker's date pickers. null clears a date. Creates the
 * tracker row (status VIEWED) when the job has none yet, so a saved job can carry a deadline.
 */
export const ApplicationDatesInput = z
  .object({
    deadline: z.iso.datetime().nullable().optional(),
    interviewAt: z.iso.datetime().nullable().optional(),
    /** Overrides the automatic follow-up time (last status change + follow-up days). */
    followUpAt: z.iso.datetime().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one date' });
export type ApplicationDatesInput = z.infer<typeof ApplicationDatesInput>;

// ── Skill gaps (F7, D120) ─────────────────────────────────────────────────────

/**
 * `GET /skill-gaps` — skills missing across the user's top 15 matches (the same eligible list as
 * `/jobs`: India or remote, zero-experience, validated, inside 60 days), ranked. Rules only.
 */
export const SkillGapReport = z.object({
  /** How many top matches the report is built from (up to 15). */
  basedOn: z.number().int().min(0).max(15),
  generatedAt: z.iso.datetime(),
  gaps: z.array(
    z.object({
      /** Canonical name: "PostgreSQL", never "postgres". */
      skill: z.string(),
      missingIn: z.number().int().min(1),
      of: z.number().int().min(1),
      /** Up to 3 of those jobs, best match first. */
      jobs: z.array(z.object({ id: z.uuid(), title: z.string(), company: z.string() })).max(3),
      /** From the curated, owner-approved map only; empty when none is approved. */
      links: z.array(z.object({ title: z.string(), url: z.url(), publisher: z.string() })).max(3),
    }),
  ),
});
export type SkillGapReport = z.infer<typeof SkillGapReport>;
