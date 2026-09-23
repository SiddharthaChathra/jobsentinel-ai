import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { Env } from '@jobsentinel/config';
import { ENV } from '../common/config/config.module';
import { DB, type Db } from '../common/db/db.module';
import { jobs, notifications, telegramLinks } from '../common/db/schema';
import {
  formatDigest,
  formatInstant,
  formatSystemAlert,
  instantButtons,
  isPublicUrl,
  type DigestData,
  type JobAlertData,
} from './format';
import { TelegramClient, TelegramError, type InlineButton } from './telegram.client';

import { HTTP_CLIENT } from '../common/http/http.module';
import type { HttpClientPort } from '../common/http/http-client';

export interface DispatchResult {
  claimed: number;
  sent: number;
  failed: number;
  retrying: number;
  skipped: number;
}

/** Attempt N waits this long before the next try (docs 10 §5). After the last one, FAILED. */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000];

/**
 * Delivers queued notifications (docs 10 §5).
 *
 * Rows are claimed with `FOR UPDATE SKIP LOCKED`, so two workers never send the same message.
 * A `WEB` row is "sent" by marking it — the inbox is complete even when Telegram is down, which
 * is the point of having two channels.
 */
@Injectable()
export class DispatcherService {
  private readonly logger = new Logger(DispatcherService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(HTTP_CLIENT) private readonly http: HttpClientPort,
    private readonly telegram: TelegramClient,
  ) {}

  private async isUrlBroken(url: string): Promise<boolean> {
    try {
      const res = await this.http.request(url, { method: 'HEAD', timeoutMs: 4000, retries: 0 });
      return isBrokenApplicationStatus(res.status);
    } catch {
      // A timeout or a refused connection is indistinguishable from a dead link here, and the
      // fallback costs the user nothing: the source listing reaches the same posting.
      return true;
    }
  }

  async dispatchPending(opts: { batch?: number } = {}): Promise<DispatchResult> {
    const batch = opts.batch ?? 50;
    const result: DispatchResult = { claimed: 0, sent: 0, failed: 0, retrying: 0, skipped: 0 };

    const claimed = await this.claim(batch);
    result.claimed = claimed.length;

    for (const row of claimed) {
      if (row.channel === 'WEB') {
        await this.markSent(row.id, row.jobId);
        result.sent++;
        continue;
      }
      if (!this.telegram.configured) {
        // Not an error: Telegram simply is not set up. Leave it pending rather than burning
        // attempts, so it delivers as soon as a token exists.
        await this.release(row.id);
        result.skipped++;
        continue;
      }

      const chatId = await this.chatIdFor(row.userId);
      if (chatId === null) {
        await this.finish(row.id, 'SKIPPED', 'no linked Telegram chat');
        result.skipped++;
        continue;
      }

      try {
        if (row.type === 'INSTANT') {
          const job = row.payload as JobAlertData & { fallbackNote?: boolean };
          if (job.sourceUrl && job.applicationUrl !== job.sourceUrl) {
            if (await this.isUrlBroken(job.applicationUrl)) {
              row.payload = { ...job, applicationUrl: job.sourceUrl, fallbackNote: true };
            }
          }
        } else if (row.type === 'DIGEST') {
          const digest = row.payload as DigestData;
          const jobs = await Promise.all(
            (digest.jobs ?? []).map(async (j) => {
              if (
                j.sourceUrl &&
                j.applicationUrl !== j.sourceUrl &&
                (await this.isUrlBroken(j.applicationUrl))
              ) {
                return { ...j, applicationUrl: j.sourceUrl };
              }
              return j;
            }),
          );
          row.payload = { ...digest, jobs };
        }

        const { text, buttons } = this.render(row);
        await this.telegram.sendMessage({ chatId, text, buttons });
        await this.markSent(row.id, row.jobId);
        result.sent++;
      } catch (err) {
        const outcome = await this.handleFailure(row, err);
        if (outcome === 'FAILED') result.failed++;
        else result.retrying++;
      }
    }
    return result;
  }

  /** Claims due rows atomically so a second worker cannot pick them up. */
  private async claim(batch: number) {
    return this.db.transaction(async (tx) => {
      const due = await tx
        .select({
          id: notifications.id,
          userId: notifications.userId,
          jobId: notifications.jobId,
          channel: notifications.channel,
          type: notifications.type,
          payload: notifications.payload,
          attempts: notifications.attempts,
        })
        .from(notifications)
        .where(
          and(
            eq(notifications.status, 'PENDING'),
            or(isNull(notifications.sendAfter), sql`${notifications.sendAfter} <= now()`),
          ),
        )
        .orderBy(notifications.createdAt)
        .limit(batch)
        .for('update', { skipLocked: true });

      if (due.length > 0) {
        await tx
          .update(notifications)
          .set({ attempts: sql`${notifications.attempts} + 1`, updatedAt: new Date() })
          .where(
            sql`${notifications.id} in ${sql.raw(`(${due.map((d) => `'${d.id}'`).join(',')})`)}`,
          );
      }
      return due;
    });
  }

  private render(row: { type: string; payload: unknown }): {
    text: string;
    buttons?: InlineButton[][];
  } {
    const dashboard = this.env.APP_BASE_URL ?? 'http://localhost:3000';
    if (row.type === 'INSTANT') {
      const job = reviveAlert(row.payload as JobAlertData & { fallbackNote?: boolean });
      return {
        text: formatInstant(job, new Date(), job.fallbackNote),
        buttons: instantButtons(job, dashboard),
      };
    }
    if (row.type === 'DIGEST') {
      const digest = row.payload as DigestData;
      return {
        text: formatDigest({ ...digest, jobs: (digest.jobs ?? []).map(reviveAlert) }),
        // Same rule as the instant alert: a local dashboard URL would void the whole message.
        buttons: isPublicUrl(dashboard)
          ? [[{ text: '📊 Open dashboard', url: `${dashboard}/dashboard` }]]
          : undefined,
      };
    }
    const p = row.payload as { title?: string; detail?: string };
    return { text: formatSystemAlert(p.title ?? 'JobSentinel', p.detail ?? '') };
  }

  private async handleFailure(
    row: { id: string; attempts: number },
    err: unknown,
  ): Promise<'FAILED' | 'RETRY'> {
    const message = err instanceof Error ? err.message : String(err);
    const attempts = row.attempts + 1; // claim() already incremented in the DB

    if (err instanceof TelegramError && err.permanent) {
      // Retrying a blocked bot or a dead chat can never succeed.
      await this.finish(row.id, 'FAILED', message);
      this.logger.warn(`notification ${row.id} permanently failed: ${message}`);
      return 'FAILED';
    }
    if (attempts >= BACKOFF_MS.length) {
      await this.finish(row.id, 'FAILED', message);
      return 'FAILED';
    }

    // Telegram's own retry_after wins over our backoff when it is longer.
    const backoff = BACKOFF_MS[attempts] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!;
    const retryAfterMs =
      err instanceof TelegramError && err.retryAfterSec ? err.retryAfterSec * 1000 : 0;
    const waitMs = Math.max(backoff, retryAfterMs);
    await this.db
      .update(notifications)
      .set({
        status: 'PENDING',
        error: message,
        sendAfter: new Date(Date.now() + waitMs),
        updatedAt: new Date(),
      })
      .where(eq(notifications.id, row.id));
    return 'RETRY';
  }

  private async markSent(id: string, jobId: string | null): Promise<void> {
    const sentAt = new Date();
    await this.db
      .update(notifications)
      .set({ status: 'SENT', sentAt, error: null, updatedAt: sentAt })
      .where(eq(notifications.id, id));
    if (jobId) {
      // `notified_at` reflects "the user was told", on whichever channel got through first.
      await this.db
        .update(jobs)
        .set({ status: 'NOTIFIED', notifiedAt: sentAt, updatedAt: sentAt })
        .where(and(eq(jobs.id, jobId), sql`${jobs.status} in ('MATCHED','NOTIFY_PENDING')`));
    }
  }

  private async finish(id: string, status: 'FAILED' | 'SKIPPED', error: string): Promise<void> {
    await this.db
      .update(notifications)
      .set({ status, error, updatedAt: new Date() })
      .where(eq(notifications.id, id));
  }

  /** Puts a claimed row back without counting the attempt against it. */
  private async release(id: string): Promise<void> {
    await this.db
      .update(notifications)
      .set({ attempts: sql`greatest(${notifications.attempts} - 1, 0)`, updatedAt: new Date() })
      .where(eq(notifications.id, id));
  }

  private async chatIdFor(userId: string): Promise<bigint | null> {
    const link = await this.db.query.telegramLinks.findFirst({
      where: eq(telegramLinks.userId, userId),
      columns: { chatId: true },
    });
    return link?.chatId ?? null;
  }
}

/** JSON round-trips dates to strings; the formatters need real `Date`s. */
function reviveAlert<T extends JobAlertData>(job: T): T {
  return {
    ...job,
    postedAt: job.postedAt ? new Date(job.postedAt) : null,
    deadline: job.deadline ? new Date(job.deadline) : null,
  };
}

/**
 * Whether a HEAD response means the apply link is genuinely dead, as opposed to an ATS that simply
 * dislikes automated requests. 403 and 405 are how bot-protected boards answer a HEAD they are
 * perfectly willing to serve to a browser — treating those as broken would replace a working
 * direct apply link with the slower source listing on most of the biggest boards (docs 10 §3).
 */
export function isBrokenApplicationStatus(status: number): boolean {
  return status >= 400 && status !== 405 && status !== 403;
}
