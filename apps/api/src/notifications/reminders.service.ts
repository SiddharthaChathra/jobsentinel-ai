import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { REMINDERS } from '@jobsentinel/config';
import type {
  ApplicationStatus,
  NotificationChannel,
  ReminderItem,
  ReminderKind,
  ReminderStatus,
} from '@jobsentinel/types';
import {
  isStaleOnArrival,
  planReminders,
  reminderMessage,
  reminderQuietEnd,
} from '@jobsentinel/validation';
import { DB, type Db } from '../common/db/db.module';
import { notifications, reminders } from '../common/db/schema';
import { AppError } from '../common/errors/app-error';
import { NotificationsService } from './notifications.service';

type TrackerRow = {
  user_id: string;
  job_id: string;
  saved: boolean;
  status: ApplicationStatus | null;
  last_status_change_at: string | Date | null;
  follow_up_at: string | Date | null;
  interview_at: string | Date | null;
  deadline: string | Date | null;
  follow_up_days: number;
  timezone: string;
  reminders_enabled: boolean;
};

type DueRow = {
  id: string;
  user_id: string;
  job_id: string;
  kind: ReminderKind;
  deliveries: number;
  title: string;
  company: string;
  last_status_change_at: string | Date | null;
  reminders_enabled: boolean;
};

export interface PlanResult {
  created: number;
  cancelled: number;
  revived: number;
}

export interface DeliverResult {
  sent: number;
  deferred: number;
  cancelled: number;
}

const TITLES: Record<ReminderKind, string> = {
  FOLLOW_UP: 'Time to follow up',
  INTERVIEW_DAY_BEFORE: 'Interview tomorrow',
  INTERVIEW_MORNING: 'Interview today',
  DEADLINE_3D: 'Deadline in 3 days',
  DEADLINE_1D: 'Deadline tomorrow',
};

const date = (v: string | Date | null): Date | null => (v ? new Date(v) : null);

/**
 * Tracker reminders (F5, D119). Two worker steps, both safe to repeat:
 *
 * - `plan` turns every tracker row into the reminders it should have (`planReminders`), inserts
 *   the missing ones (unique `idempotency_key`) and cancels pending ones no longer wanted — a
 *   status change to INTERVIEW or REJECTED, a moved date, an unsaved job.
 * - `deliver` sends due ones through `notifications`, so the existing dispatcher delivers them to
 *   Telegram. PENDING → SENT happens in the same transaction as the insert, and the notification
 *   is unique per (reminder, delivery, channel): a reminder is never sent twice. Quiet hours
 *   (22:00-07:00 local, plus the user's own) leave it pending — deferred, never dropped.
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly notificationsSvc: NotificationsService,
  ) {}

  async plan(opts: { now?: Date; userIds?: string[] } = {}): Promise<PlanResult> {
    const now = opts.now ?? new Date();
    const scope = opts.userIds?.length
      ? sql`and ns.user_id in (${sql.join(
          opts.userIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`
      : sql``;
    // Every tracked or saved job, with the user's settings. Closed applications plan nothing,
    // which is how their pending reminders get cancelled below.
    const rows = await this.db.execute<TrackerRow>(sql`
      select ns.user_id, j.id as job_id, (s.user_id is not null) as saved, a.status,
        a.last_status_change_at, a.follow_up_at, a.interview_at,
        coalesce(a.deadline, j.deadline) as deadline,
        ns.follow_up_days, coalesce(p.timezone, 'Asia/Kolkata') as timezone, ns.reminders_enabled
      from applications a
      full outer join saved_jobs s on s.user_id = a.user_id and s.job_id = a.job_id
      join jobs j on j.id = coalesce(a.job_id, s.job_id)
      join notification_settings ns on ns.user_id = coalesce(a.user_id, s.user_id)
      left join preferences p on p.user_id = ns.user_id
      where true ${scope}`);

    const wanted = new Map<
      string,
      { userId: string; jobId: string; kind: ReminderKind; anchor: string; dueAt: Date }
    >();
    for (const r of rows) {
      if (!r.reminders_enabled) continue;
      for (const p of planReminders(
        {
          saved: r.saved,
          status: r.status,
          lastStatusChangeAt: date(r.last_status_change_at),
          followUpAt: date(r.follow_up_at),
          interviewAt: date(r.interview_at),
          deadline: date(r.deadline),
          followUpDays: r.follow_up_days,
          timezone: r.timezone,
        },
        now,
      )) {
        const key = `${r.user_id}:${r.job_id}:${p.kind}:${p.anchor}`;
        wanted.set(key, { userId: r.user_id, jobId: r.job_id, ...p });
      }
    }

    const existing = await this.db
      .select({ id: reminders.id, key: reminders.idempotencyKey, status: reminders.status })
      .from(reminders)
      .where(
        and(
          inArray(reminders.status, ['PENDING', 'CANCELLED']),
          ...(opts.userIds?.length ? [inArray(reminders.userId, opts.userIds)] : []),
        ),
      );
    const byKey = new Map(existing.map((e) => [e.key, e]));

    // Cancelled earlier but wanted again (a date moved back): pending once more.
    const revive = existing
      .filter((e) => e.status === 'CANCELLED' && wanted.has(e.key))
      .map((e) => e.id);
    // Pending but no longer wanted: the application moved on, a date changed, the job was unsaved.
    const cancel = existing
      .filter((e) => e.status === 'PENDING' && !wanted.has(e.key))
      .map((e) => e.id);

    const fresh = [...wanted.entries()]
      .filter(([key, w]) => !byKey.has(key) && !isStaleOnArrival(w.kind, w.dueAt, now))
      .map(([key, w]) => ({
        userId: w.userId,
        jobId: w.jobId,
        kind: w.kind,
        anchor: w.anchor,
        idempotencyKey: key,
        dueAt: w.dueAt,
      }));

    let created = 0;
    for (let i = 0; i < fresh.length; i += 50) {
      const inserted = await this.db
        .insert(reminders)
        .values(fresh.slice(i, i + 50))
        // A SENT or DISMISSED reminder with the same key is never planned again.
        .onConflictDoNothing({ target: reminders.idempotencyKey })
        .returning({ id: reminders.id });
      created += inserted.length;
    }
    for (let i = 0; i < cancel.length; i += 50) {
      await this.db
        .update(reminders)
        .set({ status: 'CANCELLED', cancelledReason: 'no longer relevant', updatedAt: now })
        .where(
          and(inArray(reminders.id, cancel.slice(i, i + 50)), eq(reminders.status, 'PENDING')),
        );
    }
    for (let i = 0; i < revive.length; i += 50) {
      await this.db
        .update(reminders)
        .set({ status: 'PENDING', cancelledReason: null, updatedAt: now })
        .where(
          and(inArray(reminders.id, revive.slice(i, i + 50)), eq(reminders.status, 'CANCELLED')),
        );
    }
    return { created, cancelled: cancel.length, revived: revive.length };
  }

  async deliver(
    opts: { now?: Date; batch?: number; userIds?: string[] } = {},
  ): Promise<DeliverResult> {
    const now = opts.now ?? new Date();
    const result: DeliverResult = { sent: 0, deferred: 0, cancelled: 0 };
    const scope = opts.userIds?.length
      ? sql`and r.user_id in (${sql.join(
          opts.userIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`
      : sql``;
    const due = await this.db.execute<DueRow>(sql`
      select r.id, r.user_id, r.job_id, r.kind, r.deliveries, j.title, c.name as company,
        a.last_status_change_at, ns.reminders_enabled
      from reminders r
      join jobs j on j.id = r.job_id
      join companies c on c.id = j.company_id
      join notification_settings ns on ns.user_id = r.user_id
      left join applications a on a.user_id = r.user_id and a.job_id = r.job_id
      where r.status = 'PENDING' and coalesce(r.snoozed_until, r.due_at) <= ${now.toISOString()}::timestamptz
        ${scope}
      order by coalesce(r.snoozed_until, r.due_at)
      limit ${opts.batch ?? 100}`);
    if (due.length === 0) return result;

    const contexts = new Map(
      (await this.notificationsSvc.contexts([...new Set(due.map((d) => d.user_id))])).map((c) => [
        c.userId,
        c,
      ]),
    );
    for (const r of due) {
      const ctx = contexts.get(r.user_id);
      if (!ctx || !r.reminders_enabled || ctx.settings.mode === 'DISABLED') {
        await this.db
          .update(reminders)
          .set({ status: 'CANCELLED', cancelledReason: 'reminders turned off', updatedAt: now })
          .where(and(eq(reminders.id, r.id), eq(reminders.status, 'PENDING')));
        result.cancelled++;
        continue;
      }
      // Paused or quiet: wait. The reminder stays PENDING and goes out on a later tick.
      if (ctx.settings.pausedUntil && ctx.settings.pausedUntil > now) {
        result.deferred++;
        continue;
      }
      if (reminderQuietEnd(ctx.settings, now)) {
        result.deferred++;
        continue;
      }

      const changed = date(r.last_status_change_at);
      const message = reminderMessage(r.kind, {
        title: r.title,
        company: r.company,
        daysSinceChange: changed
          ? Math.floor((now.getTime() - changed.getTime()) / 86_400_000)
          : null,
      });
      const channels: NotificationChannel[] = ['WEB'];
      if (ctx.chatId !== null && ctx.settings.telegramEnabled) channels.push('TELEGRAM');

      const sent = await this.db.transaction(async (tx) => {
        const [claimed] = await tx
          .update(reminders)
          .set({
            status: 'SENT',
            sentAt: now,
            deliveries: sql`${reminders.deliveries} + 1`,
            updatedAt: now,
          })
          .where(and(eq(reminders.id, r.id), eq(reminders.status, 'PENDING')))
          .returning({ deliveries: reminders.deliveries });
        if (!claimed) return false; // another worker took it
        await tx
          .insert(notifications)
          .values(
            channels.map((channel) => ({
              userId: r.user_id,
              jobId: null,
              channel,
              type: 'REMINDER' as const,
              status: 'PENDING' as const,
              payload: {
                reminderId: r.id,
                delivery: String(claimed.deliveries),
                kind: r.kind,
                jobId: r.job_id,
                title: TITLES[r.kind],
                detail: message,
              },
            })),
          )
          .onConflictDoNothing();
        return true;
      });
      if (sent) result.sent++;
    }
    if (result.sent + result.deferred + result.cancelled > 0) {
      this.logger.log(`reminders: ${JSON.stringify(result)}`);
    }
    return result;
  }

  /** `GET /reminders`: due (sent or overdue, not dismissed) and upcoming within `withinDays`. */
  async list(userId: string, withinDays = 7, now = new Date()): Promise<ReminderItem[]> {
    const horizon = new Date(now.getTime() + withinDays * 86_400_000);
    const recent = new Date(now.getTime() - 14 * 86_400_000);
    const rows = await this.db.execute<{
      id: string;
      kind: ReminderKind;
      status: ReminderStatus;
      due_at: string | Date;
      snoozed_until: string | Date | null;
      sent_at: string | Date | null;
      job_id: string;
      title: string;
      company: string;
      application_status: ApplicationStatus | null;
      last_status_change_at: string | Date | null;
    }>(sql`
      select r.id, r.kind, r.status, r.due_at, r.snoozed_until, r.sent_at, r.job_id,
        j.title, c.name as company, a.status as application_status, a.last_status_change_at
      from reminders r
      join jobs j on j.id = r.job_id
      join companies c on c.id = j.company_id
      left join applications a on a.user_id = r.user_id and a.job_id = r.job_id
      where r.user_id = ${userId}::uuid
        and (
          (r.status = 'PENDING' and coalesce(r.snoozed_until, r.due_at) <= ${horizon.toISOString()}::timestamptz)
          or (r.status = 'SENT' and r.sent_at >= ${recent.toISOString()}::timestamptz)
        )
      order by coalesce(r.snoozed_until, r.due_at)`);
    return rows.map((r) => {
      const when = date(r.snoozed_until) ?? new Date(r.due_at);
      const changed = date(r.last_status_change_at);
      return {
        id: r.id,
        kind: r.kind,
        status: r.status,
        state: r.status === 'SENT' || when <= now ? 'DUE' : 'UPCOMING',
        dueAt: when.toISOString(),
        snoozedUntil: date(r.snoozed_until)?.toISOString() ?? null,
        sentAt: date(r.sent_at)?.toISOString() ?? null,
        message: reminderMessage(r.kind, {
          title: r.title,
          company: r.company,
          daysSinceChange: changed
            ? Math.floor((now.getTime() - changed.getTime()) / 86_400_000)
            : null,
        }),
        job: {
          id: r.job_id,
          title: r.title,
          company: r.company,
          applicationStatus: r.application_status,
        },
      };
    });
  }

  /** Remind again in `hours` — a pending one moves; a sent one is delivered once more then. */
  async snooze(
    userId: string,
    id: string,
    hours: number = REMINDERS.defaultSnoozeHours,
  ): Promise<ReminderItem> {
    const until = new Date(Date.now() + hours * 3_600_000);
    const [row] = await this.db
      .update(reminders)
      .set({ status: 'PENDING', snoozedUntil: until, updatedAt: new Date() })
      .where(
        and(
          eq(reminders.id, id),
          eq(reminders.userId, userId),
          inArray(reminders.status, ['PENDING', 'SENT']),
        ),
      )
      .returning({ id: reminders.id });
    if (!row) throw AppError.notFound('REMINDER_NOT_FOUND');
    return this.item(userId, id);
  }

  async dismiss(userId: string, id: string): Promise<void> {
    const [row] = await this.db
      .update(reminders)
      .set({ status: 'DISMISSED', dismissedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(reminders.id, id),
          eq(reminders.userId, userId),
          inArray(reminders.status, ['PENDING', 'SENT']),
        ),
      )
      .returning({ id: reminders.id });
    if (!row) throw AppError.notFound('REMINDER_NOT_FOUND');
  }

  private async item(userId: string, id: string): Promise<ReminderItem> {
    const all = await this.list(userId, 60);
    const found = all.find((r) => r.id === id);
    if (!found) throw AppError.notFound('REMINDER_NOT_FOUND');
    return found;
  }
}
