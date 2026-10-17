import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { localDateKey, localParts } from '@jobsentinel/validation';
import { DB, type Db } from '../common/db/db.module';
import {
  companies,
  jobMatches,
  jobSources,
  jobs,
  notifications,
  telegramLinks,
} from '../common/db/schema';
import { DIGEST_MAX_JOBS, type DigestData } from './format';
import { NotificationsService, toAlertData } from './notifications.service';

export interface DigestResult {
  considered: number;
  queued: number;
  notDue: number;
}

/**
 * Builds the once-a-day summary (docs 10 §3).
 *
 * Due-ness is evaluated in the user's own timezone, and the `(user, channel, digest_date)` unique
 * index means a worker that ticks every minute still produces exactly one digest per local day.
 */
@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly notifications: NotificationsService,
  ) {}

  async sendDue(opts: { userIds?: string[]; force?: boolean } = {}): Promise<DigestResult> {
    const result: DigestResult = { considered: 0, queued: 0, notDue: 0 };
    const now = new Date();

    const settingsRows = await this.db
      .select({
        userId: sql<string>`ns.user_id`,
        digestHourLocal: sql<number>`ns.digest_hour_local`,
        mode: sql<string>`ns.mode`,
        telegramEnabled: sql<boolean>`ns.telegram_enabled`,
        includeNeedsReview: sql<boolean>`ns.include_needs_review_in_digest`,
        pausedUntil: sql<Date | null>`ns.paused_until`,
        timezone: sql<string | null>`p.timezone`,
      })
      .from(sql`notification_settings ns`)
      .leftJoin(sql`preferences p`, sql`p.user_id = ns.user_id`)
      .where(opts.userIds?.length ? sql`ns.user_id in ${idList(opts.userIds)}` : sql`true`);

    for (const s of settingsRows) {
      result.considered++;
      if (s.mode === 'DISABLED' || s.mode === 'INSTANT') {
        result.notDue++;
        continue;
      }
      if (s.pausedUntil && new Date(s.pausedUntil) > now) {
        result.notDue++;
        continue;
      }
      const timezone = s.timezone ?? 'Asia/Kolkata';
      const local = localParts(now, timezone);
      // Due once the local hour has arrived; the unique index stops it repeating that day.
      if (!opts.force && local.hour < s.digestHourLocal) {
        result.notDue++;
        continue;
      }

      const digestDate = localDateKey(now, timezone);
      const already = await this.db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, s.userId),
            eq(notifications.type, 'DIGEST'),
            eq(notifications.digestDate, digestDate),
          ),
        )
        .limit(1);
      if (already.length > 0) {
        result.notDue++;
        continue;
      }

      const data = await this.build(s.userId, timezone, s.includeNeedsReview, now);
      const channels: ('WEB' | 'TELEGRAM')[] = ['WEB'];
      if (s.telegramEnabled && (await this.hasChat(s.userId))) channels.push('TELEGRAM');

      const inserted = await this.db
        .insert(notifications)
        .values(
          channels.map((channel) => ({
            userId: s.userId,
            jobId: null,
            channel,
            type: 'DIGEST' as const,
            status: 'PENDING' as const,
            payload: data as unknown as Record<string, unknown>,
            digestDate,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: notifications.id });
      if (inserted.length > 0) result.queued++;
      else result.notDue++;
    }
    return result;
  }

  /** The numbers and the top jobs for one user's day. */
  async build(
    userId: string,
    timezone: string,
    includeNeedsReview: boolean,
    now: Date,
  ): Promise<DigestData> {
    const since = new Date(now.getTime() - 24 * 3_600_000);
    const profileVersion = await this.profileVersion(userId);
    // VALID only, whatever `includeNeedsReview` says: a held job is never sent to Telegram (D106).
    // The setting is kept for API compatibility; held jobs live in the Needs review view.
    void includeNeedsReview;
    const allowed = ['VALID'];

    const rows = await this.db
      .select({
        job: jobs,
        company: { name: companies.name, verified: companies.verificationStatus },
        match: {
          overallScore: jobMatches.overallScore,
          priority: jobMatches.priority,
          matchedSkills: jobMatches.matchedSkills,
          missingSkills: jobMatches.missingSkills,
        },
      })
      .from(jobMatches)
      .innerJoin(jobs, eq(jobs.id, jobMatches.jobId))
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .where(
        and(
          eq(jobMatches.userId, userId),
          eq(jobMatches.profileVersion, profileVersion),
          gte(jobs.firstSeenAt, since),
          sql`${jobs.closedAt} is null`,
          inArray(jobs.validationStatus, allowed as 'VALID'[]),
          // A job held at classification (status NEEDS_REVIEW) never qualifies either.
          sql`${jobs.status} <> 'NEEDS_REVIEW'`,
        ),
      )
      .orderBy(sql`${jobMatches.overallScore} desc`)
      .limit(200);

    const counts = { veryHigh: 0, high: 0, medium: 0, other: 0, needsReview: 0 };
    for (const r of rows) {
      if (r.job.validationStatus === 'NEEDS_REVIEW') counts.needsReview++;
      if (r.match.priority === 'VERY_HIGH') counts.veryHigh++;
      else if (r.match.priority === 'HIGH') counts.high++;
      else if (r.match.priority === 'MEDIUM') counts.medium++;
      else counts.other++;
    }

    const [expired] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(jobs)
      .where(and(sql`${jobs.closedAt} >= ${since.toISOString()}::timestamptz`));
    const failing = await this.db
      .select({ name: jobSources.name })
      .from(jobSources)
      .where(inArray(jobSources.status, ['FAILING', 'DISABLED']));

    return {
      dateLabel: new Date(now).toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: timezone,
      }),
      counts,
      jobs: rows.slice(0, DIGEST_MAX_JOBS).map(toAlertData),
      expiredSinceYesterday: expired?.n ?? 0,
      failingSources: failing.map((f) => f.name),
    };
  }

  private async profileVersion(userId: string): Promise<number> {
    const [ctx] = await this.notifications.contexts([userId]);
    return ctx?.profileVersion ?? 0;
  }

  private async hasChat(userId: string): Promise<boolean> {
    const link = await this.db.query.telegramLinks.findFirst({
      where: eq(telegramLinks.userId, userId),
      columns: { chatId: true },
    });
    return link?.chatId != null;
  }
}

function idList(ids: string[]) {
  return sql.raw(`(${ids.map((i) => `'${i.replace(/'/g, "''")}'`).join(',')})`);
}
