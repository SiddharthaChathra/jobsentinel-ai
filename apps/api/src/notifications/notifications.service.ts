import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type { MatchScoring, NotificationChannel } from '@jobsentinel/types';
import {
  INSTANT_FRESHNESS_HOURS,
  adzunaAttribution,
  decideNotification,
  type NotifySettings,
} from '@jobsentinel/validation';
import { DB, type Db } from '../common/db/db.module';
import {
  companies,
  jobMatches,
  jobs,
  notificationSettings,
  notifications,
  preferences,
  telegramLinks,
  users,
} from '../common/db/schema';
import { JobsQueryService } from '../jobs/jobs-query.service';
import type { JobAlertData } from './format';

export interface EnqueueResult {
  candidates: number;
  instant: number;
  digestOnly: number;
  suppressed: number;
}

/** Statuses a job can be in and still be worth alerting about. */
const ALERTABLE = ['MATCHED', 'NOTIFY_PENDING', 'NOTIFIED'] as const;

export interface UserNotifyContext {
  userId: string;
  profileVersion: number;
  settings: NotifySettings;
  fresherOnly: boolean;
  chatId: bigint | null;
}

/**
 * Turns matched jobs into queued notifications (docs 10 §2).
 *
 * This service only *decides and records*; `DispatcherService` delivers. The split matters: a
 * Telegram outage must never lose an alert, so the row exists before any network call, and the
 * web inbox is written even when Telegram is unlinked.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly jobsQuery: JobsQueryService,
  ) {}

  async enqueuePending(opts: { batch?: number; userIds?: string[] } = {}): Promise<EnqueueResult> {
    const batch = opts.batch ?? 100;
    const result: EnqueueResult = { candidates: 0, instant: 0, digestOnly: 0, suppressed: 0 };
    const now = new Date();
    const freshCutoff = new Date(now.getTime() - INSTANT_FRESHNESS_HOURS * 3_600_000);

    for (const ctx of await this.contexts(opts.userIds)) {
      // The dashboard's own eligibility (D127): a job the list would not show is never alerted.
      const eligible = this.jobsQuery.eligibleWhere(await this.jobsQuery.viewer(ctx.userId));
      // Only jobs new enough to still qualify as a discovery, and not already alerted.
      // This bounds the scan: an older job can never become an instant alert (docs 10 §2).
      const rows = await this.db
        .select({
          job: jobs,
          company: { name: companies.name, verified: companies.verificationStatus },
          match: {
            overallScore: jobMatches.overallScore,
            priority: jobMatches.priority,
            matchedSkills: jobMatches.matchedSkills,
            missingSkills: jobMatches.missingSkills,
            scoring: jobMatches.scoring,
          },
          adzunaCountry: ADZUNA_COUNTRY,
        })
        .from(jobMatches)
        .innerJoin(jobs, eq(jobs.id, jobMatches.jobId))
        .innerJoin(companies, eq(companies.id, jobs.companyId))
        .where(
          and(
            eq(jobMatches.userId, ctx.userId),
            eq(jobMatches.profileVersion, ctx.profileVersion),
            inArray(jobs.status, [...ALERTABLE]),
            gte(jobs.firstSeenAt, freshCutoff),
            sql`${jobs.closedAt} is null`,
            ...eligible,
            sql`not exists (select 1 from ${notifications} n
                 where n.user_id = ${ctx.userId} and n.job_id = ${jobs.id} and n.type = 'INSTANT')`,
          ),
        )
        .orderBy(sql`${jobMatches.overallScore} desc`)
        .limit(batch);

      result.candidates += rows.length;

      for (const row of rows) {
        const decision = decideNotification(
          ctx.settings,
          {
            overallScore: row.match.overallScore,
            priority: row.match.priority,
            validationStatus: row.job.validationStatus,
            firstSeenAt: row.job.firstSeenAt,
            fresherEligible: row.job.fresherEligible,
          },
          now,
        );
        if (decision.action === 'NONE') {
          result.suppressed++;
          continue;
        }
        if (decision.action === 'DIGEST') {
          result.digestOnly++;
          continue; // the digest is assembled from matches at send time, not queued per job
        }

        const payload = toAlertData(row);
        const channels: NotificationChannel[] = ['WEB'];
        if (ctx.chatId !== null && ctx.settings.telegramEnabled) channels.push('TELEGRAM');

        // ON CONFLICT DO NOTHING against the (user, job, channel, type) unique index is the
        // "never notify twice" guarantee — a re-match or worker restart cannot duplicate it.
        const inserted = await this.db
          .insert(notifications)
          .values(
            channels.map((channel) => ({
              userId: ctx.userId,
              jobId: row.job.id,
              channel,
              type: 'INSTANT' as const,
              status: 'PENDING' as const,
              payload,
              sendAfter: decision.sendAfter,
            })),
          )
          .onConflictDoNothing()
          .returning({ id: notifications.id });
        if (inserted.length > 0) {
          result.instant++;
          await this.db
            .update(jobs)
            .set({ status: 'NOTIFY_PENDING', updatedAt: new Date() })
            .where(and(eq(jobs.id, row.job.id), eq(jobs.status, 'MATCHED')));
        }
      }
    }
    return result;
  }

  /** Queues a one-off notification the user asked for (`POST /notifications/test`). */
  async enqueueTest(userId: string): Promise<{ channels: NotificationChannel[] }> {
    const [ctx] = await this.contexts([userId]);
    const channels: NotificationChannel[] = ['WEB'];
    if (ctx?.chatId != null && ctx.settings.telegramEnabled) channels.push('TELEGRAM');
    await this.db.insert(notifications).values(
      channels.map((channel) => ({
        userId,
        jobId: null,
        channel,
        type: 'TEST' as const,
        status: 'PENDING' as const,
        payload: {
          title: 'JobSentinel test alert',
          detail: 'If you can read this, alerts are working.',
        },
      })),
    );
    return { channels };
  }

  /**
   * Queues a system alert, rate-limited to one per type per 6 h so a flapping source cannot
   * turn into a stream of messages (docs 10 §3).
   */
  async enqueueSystemAlert(
    userId: string,
    key: string,
    title: string,
    detail: string,
    windowHours = 6,
  ): Promise<boolean> {
    const since = new Date(Date.now() - windowHours * 3_600_000);
    const [recent] = await this.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.type, 'SYSTEM'),
          gte(notifications.createdAt, since),
          sql`${notifications.payload}->>'key' = ${key}`,
        ),
      )
      .limit(1);
    if (recent) return false;

    const [ctx] = await this.contexts([userId]);
    const channels: NotificationChannel[] = ['WEB'];
    if (ctx?.chatId != null && ctx.settings.telegramEnabled) channels.push('TELEGRAM');
    await this.db.insert(notifications).values(
      channels.map((channel) => ({
        userId,
        jobId: null,
        channel,
        type: 'SYSTEM' as const,
        status: 'PENDING' as const,
        payload: { key, title, detail },
      })),
    );
    return true;
  }

  /** Admins receive operational alerts such as an auto-paused source (F2, D103). */
  async adminIds(): Promise<string[]> {
    const rows = await this.db.select({ id: users.id }).from(users).where(eq(users.isAdmin, true));
    return rows.map((r) => r.id);
  }

  /** Everyone who could receive an alert, with the settings that govern it. */
  async contexts(userIds?: string[]): Promise<UserNotifyContext[]> {
    if (userIds?.length === 0) return [];
    const rows = await this.db
      .select({
        userId: users.id,
        profileVersion: users.profileVersion,
        mode: notificationSettings.mode,
        instantMinScore: notificationSettings.instantMinScore,
        quietHoursStart: notificationSettings.quietHoursStart,
        quietHoursEnd: notificationSettings.quietHoursEnd,
        includeNeedsReviewInDigest: notificationSettings.includeNeedsReviewInDigest,
        telegramEnabled: notificationSettings.telegramEnabled,
        pausedUntil: notificationSettings.pausedUntil,
        digestHourLocal: notificationSettings.digestHourLocal,
        timezone: preferences.timezone,
        fresherOnly: preferences.fresherOnly,
        chatId: telegramLinks.chatId,
      })
      .from(users)
      .innerJoin(notificationSettings, eq(notificationSettings.userId, users.id))
      .leftJoin(preferences, eq(preferences.userId, users.id))
      .leftJoin(telegramLinks, eq(telegramLinks.userId, users.id))
      .where(userIds ? inArray(users.id, userIds) : undefined);

    return rows.map((r) => ({
      userId: r.userId,
      profileVersion: r.profileVersion,
      chatId: r.chatId,
      settings: {
        mode: r.mode,
        instantMinScore: r.instantMinScore,
        quietHoursStart: r.quietHoursStart,
        quietHoursEnd: r.quietHoursEnd,
        includeNeedsReviewInDigest: r.includeNeedsReviewInDigest,
        telegramEnabled: r.telegramEnabled,
        pausedUntil: r.pausedUntil,
        timezone: r.timezone ?? 'Asia/Kolkata',
      },
      fresherOnly: r.fresherOnly ?? false,
    }));
  }

  /** Creates the settings row a new user needs, if onboarding has not already. */
  async ensureSettings(userId: string): Promise<void> {
    await this.db.insert(notificationSettings).values({ userId }).onConflictDoNothing();
  }

  digestHourFor(row: { digestHourLocal: number }): number {
    return row.digestHourLocal;
  }
}

type AlertRow = {
  job: typeof jobs.$inferSelect;
  company: { name: string; verified: string };
  match: {
    overallScore: number;
    priority: string;
    matchedSkills: string[];
    missingSkills: string[];
    scoring?: MatchScoring;
  };
  adzunaCountry?: string | null;
};

/** The Adzuna search country when the displayed content is Adzuna's (D115); null otherwise. */
export const ADZUNA_COUNTRY = sql<
  string | null
>`(select coalesce(s.config->>'country', 'in') from job_source_mappings m join job_sources s on s.id = m.source_id where m.job_id = ${jobs.id} and m.is_primary and s.adapter = 'adzuna' limit 1)`;

/** Snapshots everything the message needs, so the dispatcher never re-queries mid-send. */
export function toAlertData(row: AlertRow): JobAlertData {
  const url = row.job.finalApplicationUrl ?? row.job.applicationUrl ?? row.job.sourceUrl;
  return {
    jobId: row.job.id,
    title: row.job.title,
    company: row.company.name,
    location: row.job.locationCity ?? row.job.locationCountry ?? row.job.locationText,
    isRemote: row.job.isRemote,
    experienceText: row.job.experienceText,
    fresherEligible: row.job.fresherEligible,
    salaryText: row.job.salaryText,
    salaryDisclosed: row.job.salaryDisclosed,
    score: row.match.overallScore,
    priority: row.match.priority as JobAlertData['priority'],
    scoring: row.match.scoring,
    attribution:
      row.adzunaCountry === undefined || row.adzunaCountry === null
        ? null
        : adzunaAttribution(row.adzunaCountry),
    matchedSkills: row.match.matchedSkills,
    missingSkills: row.match.missingSkills,
    companyVerified: row.company.verified === 'VERIFIED',
    applicationVerified: row.job.validationStatus === 'VALID',
    applicationUrl: url,
    sourceUrl: row.job.sourceUrl,
    applicationHost: hostOf(url),
    postedAt: row.job.postedAt,
    deadline: row.job.deadline,
  };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
