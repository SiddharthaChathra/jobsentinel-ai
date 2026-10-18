import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { PriorityBand } from '@jobsentinel/types';
import { quietWindowEnd, reminderMessage, weeklySummaryWindow } from '@jobsentinel/validation';
import { DB, type Db } from '../common/db/db.module';
import {
  companies,
  jobMatches,
  jobSources,
  jobs,
  notifications,
  reminders,
} from '../common/db/schema';
import { fresherRoleSql } from '../jobs/jobs-query.service';
import { SkillGapsService } from '../jobs/skill-gaps.service';
import type { WeeklyData } from './format';
import { formatWeekly } from './format';
import { NotificationsService } from './notifications.service';

export interface WeeklyResult {
  considered: number;
  queued: number;
  notDue: number;
}

const LISTABLE = ['VALID', 'MATCHED', 'NOTIFY_PENDING', 'NOTIFIED'] as const;

/**
 * Weekly Telegram summary (F6, D121): Sunday 09:00 in the user's timezone, opt-in
 * (`weekly_summary_enabled`). Built on the daily digest's pieces — the same notification row
 * shape, the same dispatcher — and idempotent per week through the dated unique index
 * (`user, channel, type, digest_date` with digest_date = that Sunday).
 */
@Injectable()
export class WeeklySummaryService {
  private readonly logger = new Logger(WeeklySummaryService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly notificationsSvc: NotificationsService,
    private readonly skillGaps: SkillGapsService,
  ) {}

  async sendDue(opts: { now?: Date; userIds?: string[] } = {}): Promise<WeeklyResult> {
    const now = opts.now ?? new Date();
    const result: WeeklyResult = { considered: 0, queued: 0, notDue: 0 };
    const optedIn = await this.db.execute<{ user_id: string }>(sql`
      select user_id from notification_settings
      where weekly_summary_enabled and mode <> 'DISABLED'
        ${
          opts.userIds?.length
            ? sql`and user_id in (${sql.join(
                opts.userIds.map((id) => sql`${id}::uuid`),
                sql`, `,
              )})`
            : sql``
        }`);
    if (optedIn.length === 0) return result;
    const contexts = await this.notificationsSvc.contexts(optedIn.map((r) => r.user_id));

    for (const ctx of contexts) {
      result.considered++;
      const tz = ctx.settings.timezone;
      const window = weeklySummaryWindow(now, tz);
      if (!window.due || (ctx.settings.pausedUntil && ctx.settings.pausedUntil > now)) {
        result.notDue++;
        continue;
      }
      const [already] = await this.db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, ctx.userId),
            eq(notifications.type, 'WEEKLY'),
            eq(notifications.digestDate, window.weekKey),
          ),
        )
        .limit(1);
      if (already) {
        result.notDue++;
        continue;
      }

      const data = await this.build(ctx.userId, ctx.profileVersion, window, now, tz);
      const channels: ('WEB' | 'TELEGRAM')[] = ['WEB'];
      if (ctx.chatId !== null && ctx.settings.telegramEnabled) channels.push('TELEGRAM');
      // 09:00 is outside 22:00-07:00, but the user's own quiet hours may cover it: delay, never drop.
      const sendAfter = quietWindowEnd(ctx.settings, now);
      const inserted = await this.db
        .insert(notifications)
        .values(
          channels.map((channel) => ({
            userId: ctx.userId,
            jobId: null,
            channel,
            type: 'WEEKLY' as const,
            status: 'PENDING' as const,
            digestDate: window.weekKey,
            sendAfter,
            payload: {
              ...data,
              title: `Weekly summary — ${data.rangeLabel}`,
              // The inbox shows plain text; Telegram renders the structured data.
              detail: formatWeekly(data)
                .replace(/<[^>]+>/g, '')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, '&'),
            },
          })),
        )
        .onConflictDoNothing()
        .returning({ id: notifications.id });
      if (inserted.length > 0) result.queued++;
      else result.notDue++;
    }
    if (result.queued) this.logger.log(`weekly summaries queued: ${result.queued}`);
    return result;
  }

  /** The week's numbers for one user. Every count covers [from, to). */
  async build(
    userId: string,
    profileVersion: number,
    window: { from: Date; to: Date },
    now: Date,
    timezone: string,
  ): Promise<WeeklyData> {
    const from = window.from.toISOString();
    const to = window.to.toISOString();

    // New VALID jobs by priority: the list's own eligibility (D96, D106) — VALID, listable, not
    // held, open, zero-experience — first seen this week. Never a held or placeholder job.
    const jobRows = await this.db
      .select({
        priority: jobMatches.priority,
        title: jobs.title,
        company: companies.name,
        score: jobMatches.overallScore,
        id: jobs.id,
      })
      .from(jobMatches)
      .innerJoin(jobs, eq(jobs.id, jobMatches.jobId))
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .where(
        and(
          eq(jobMatches.userId, userId),
          eq(jobMatches.profileVersion, profileVersion),
          inArray(jobs.status, [...LISTABLE]),
          eq(jobs.validationStatus, 'VALID'),
          sql`${jobs.holdReason} is null`,
          sql`${jobs.closedAt} is null`,
          fresherRoleSql('jobs'),
          gte(jobs.firstSeenAt, window.from),
          lt(jobs.firstSeenAt, window.to),
        ),
      )
      .orderBy(sql`${jobMatches.overallScore} desc`);
    const byPriority: Record<PriorityBand, number> = { VERY_HIGH: 0, HIGH: 0, MEDIUM: 0, OTHER: 0 };
    for (const r of jobRows) byPriority[r.priority]++;

    // Applications made this week, and status changes (from the tracker's own history).
    const [apps] = await this.db.execute<{
      applied: number;
      changes: Record<string, number> | null;
    }>(sql`
      select
        (select count(*)::int from applications
          where user_id = ${userId}::uuid and applied_at >= ${from}::timestamptz and applied_at < ${to}::timestamptz) as applied,
        (select jsonb_object_agg(status, n) from (
          select h->>'status' as status, count(*)::int as n
          from applications a, jsonb_array_elements(a.history) h
          where a.user_id = ${userId}::uuid
            and (h->>'at')::timestamptz >= ${from}::timestamptz and (h->>'at')::timestamptz < ${to}::timestamptz
            and h->>'status' <> 'VIEWED'
          group by 1) s) as changes`);

    // Reminders and deadlines in the coming week.
    const horizon = new Date(now.getTime() + 7 * 86_400_000);
    const upcoming = await this.db
      .select({
        kind: reminders.kind,
        dueAt: reminders.dueAt,
        title: jobs.title,
        company: companies.name,
      })
      .from(reminders)
      .innerJoin(jobs, eq(jobs.id, reminders.jobId))
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .where(
        and(
          eq(reminders.userId, userId),
          eq(reminders.status, 'PENDING'),
          sql`coalesce(${reminders.snoozedUntil}, ${reminders.dueAt}) <= ${horizon.toISOString()}::timestamptz`,
        ),
      )
      .orderBy(reminders.dueAt);

    const gaps = await this.skillGaps.report(userId, { limit: 3 });

    // Paused or failing sources: health of the system the user relies on.
    const unhealthy = await this.db
      .select({ name: jobSources.name, status: jobSources.status })
      .from(jobSources)
      .where(inArray(jobSources.status, ['PAUSED_AUTO', 'FAILING', 'DISABLED']));

    const fmt = (d: Date) =>
      d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: timezone });
    return {
      rangeLabel: `${fmt(window.from)} – ${fmt(new Date(window.to.getTime() - 1))}`,
      newJobs: { total: jobRows.length, byPriority },
      topJobs: jobRows
        .slice(0, 3)
        .map((j) => ({ title: j.title, company: j.company, score: j.score })),
      applications: { applied: apps?.applied ?? 0, statusChanges: apps?.changes ?? {} },
      upcoming: {
        total: upcoming.length,
        items: upcoming
          .slice(0, 3)
          .map((u) => reminderMessage(u.kind, { title: u.title, company: u.company })),
      },
      skillGaps: gaps.gaps.map((g) => ({ skill: g.skill, missingIn: g.missingIn, of: g.of })),
      sources: {
        paused: unhealthy.filter((s) => s.status === 'PAUSED_AUTO').map((s) => s.name),
        failing: unhealthy.filter((s) => s.status !== 'PAUSED_AUTO').map((s) => s.name),
      },
    };
  }
}
