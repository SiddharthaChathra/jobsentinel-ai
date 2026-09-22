import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import {
  InboxQuery,
  NotificationSettingsInput,
  type InboxItem,
  type InboxSummary,
  type NotificationSettings,
  type TelegramLinkStart,
  type TelegramLinkState,
} from '@jobsentinel/types';
import type { AuthenticatedUser } from '../auth/auth.types';
import { DB, type Db } from '../common/db/db.module';
import { notificationSettings, notifications, telegramLinks } from '../common/db/schema';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AppError } from '../common/errors/app-error';
import { enveloped } from '../common/interceptors/envelope.interceptor';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { formatInstant, type JobAlertData } from './format';
import { NotificationsService } from './notifications.service';
import { TelegramClient } from './telegram.client';

const LINK_CODE_TTL_MS = 15 * 60_000;
const DEFAULT_LIMIT = 30;

/** Inbox, settings and Telegram linking (docs 03 §6, docs 10 §4 and §6). */
@Controller()
export class NotificationsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly service: NotificationsService,
    private readonly telegram: TelegramClient,
  ) {}

  @Get('notifications')
  async inbox(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(InboxQuery)) query: InboxQuery,
  ) {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const before = query.cursor
      ? new Date(Buffer.from(query.cursor, 'base64url').toString())
      : null;
    const rows = await this.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, user.id),
          // The inbox is the WEB channel: Telegram rows are delivery records, not inbox items.
          eq(notifications.channel, 'WEB'),
          ...(query.unreadOnly ? [isNull(notifications.readAt)] : []),
          ...(before && !Number.isNaN(before.getTime())
            ? [lt(notifications.createdAt, before)]
            : []),
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return enveloped<InboxItem[]>(page.map(toInboxItem), {
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(last.createdAt.toISOString()).toString('base64url')
          : null,
    });
  }

  @Get('notifications/summary')
  async summary(@CurrentUser() user: AuthenticatedUser): Promise<InboxSummary> {
    const [row] = await this.db
      .select({ unread: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, user.id),
          eq(notifications.channel, 'WEB'),
          isNull(notifications.readAt),
        ),
      );
    return { unread: row?.unread ?? 0 };
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InboxItem> {
    const [row] = await this.db
      .update(notifications)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, user.id)))
      .returning();
    if (!row) throw AppError.notFound('NOTIFICATION_NOT_FOUND');
    return toInboxItem(row);
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  async markAllRead(@CurrentUser() user: AuthenticatedUser): Promise<InboxSummary> {
    await this.db
      .update(notifications)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(notifications.userId, user.id),
          eq(notifications.channel, 'WEB'),
          isNull(notifications.readAt),
        ),
      );
    return { unread: 0 };
  }

  @Get('notifications/settings')
  settings(@CurrentUser() user: AuthenticatedUser): Promise<NotificationSettings> {
    return this.readSettings(user.id);
  }

  @Put('notifications/settings')
  async updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(NotificationSettingsInput)) body: NotificationSettingsInput,
  ): Promise<NotificationSettings> {
    await this.service.ensureSettings(user.id);
    const patch: Partial<typeof notificationSettings.$inferInsert> = { updatedAt: new Date() };
    if (body.mode !== undefined) patch.mode = body.mode;
    if (body.digestHourLocal !== undefined) patch.digestHourLocal = body.digestHourLocal;
    if (body.quietHoursStart !== undefined) patch.quietHoursStart = body.quietHoursStart;
    if (body.quietHoursEnd !== undefined) patch.quietHoursEnd = body.quietHoursEnd;
    if (body.instantMinScore !== undefined) patch.instantMinScore = body.instantMinScore;
    if (body.includeNeedsReviewInDigest !== undefined) {
      patch.includeNeedsReviewInDigest = body.includeNeedsReviewInDigest;
    }
    if (body.telegramEnabled !== undefined) patch.telegramEnabled = body.telegramEnabled;
    if (body.pausedUntil !== undefined) {
      patch.pausedUntil = body.pausedUntil === null ? null : new Date(body.pausedUntil);
    }
    await this.db
      .update(notificationSettings)
      .set(patch)
      .where(eq(notificationSettings.userId, user.id));
    return this.readSettings(user.id);
  }

  /** Starts the linking handshake: a short-lived code the bot exchanges for a chat (docs 10 §4). */
  @Post('telegram/link')
  @HttpCode(200)
  async startLink(@CurrentUser() user: AuthenticatedUser): Promise<TelegramLinkStart> {
    if (!this.telegram.configured || !this.telegram.botUsername) {
      throw AppError.unavailable(
        'TELEGRAM_NOT_CONFIGURED',
        'No Telegram bot is configured on the server.',
      );
    }
    const code = randomBytes(9).toString('base64url');
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
    await this.db
      .insert(telegramLinks)
      .values({ userId: user.id, linkCode: code, linkCodeExpiresAt: expiresAt })
      .onConflictDoUpdate({
        target: telegramLinks.userId,
        set: { linkCode: code, linkCodeExpiresAt: expiresAt, updatedAt: new Date() },
      });
    return { url: this.telegram.linkUrl(code)!, code, expiresAt: expiresAt.toISOString() };
  }

  @Post('telegram/unlink')
  @HttpCode(200)
  async unlink(@CurrentUser() user: AuthenticatedUser): Promise<TelegramLinkState> {
    await this.db
      .update(telegramLinks)
      .set({
        chatId: null,
        linkedAt: null,
        linkCode: null,
        linkCodeExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(telegramLinks.userId, user.id));
    return this.linkState(user.id);
  }

  /** Sends a real alert through every configured channel so the user can prove it works. */
  @Post('notifications/test')
  @HttpCode(202)
  test(@CurrentUser() user: AuthenticatedUser) {
    return this.service.enqueueTest(user.id);
  }

  private async readSettings(userId: string): Promise<NotificationSettings> {
    await this.service.ensureSettings(userId);
    const row = await this.db.query.notificationSettings.findFirst({
      where: eq(notificationSettings.userId, userId),
    });
    if (!row) throw AppError.notFound('SETTINGS_NOT_FOUND');
    return {
      mode: row.mode,
      digestHourLocal: row.digestHourLocal,
      quietHoursStart: row.quietHoursStart,
      quietHoursEnd: row.quietHoursEnd,
      instantMinScore: row.instantMinScore,
      includeNeedsReviewInDigest: row.includeNeedsReviewInDigest,
      telegramEnabled: row.telegramEnabled,
      pausedUntil: row.pausedUntil?.toISOString() ?? null,
      telegram: await this.linkState(userId),
    };
  }

  private async linkState(userId: string): Promise<TelegramLinkState> {
    const link = await this.db.query.telegramLinks.findFirst({
      where: eq(telegramLinks.userId, userId),
    });
    return {
      available: this.telegram.configured && this.telegram.botUsername !== null,
      linked: link?.chatId != null,
      username: link?.telegramUsername ?? null,
      linkedAt: link?.linkedAt?.toISOString() ?? null,
    };
  }
}

function toInboxItem(row: typeof notifications.$inferSelect): InboxItem {
  const payload = row.payload as Partial<JobAlertData> & { title?: string; detail?: string };
  const isJob = row.jobId !== null && typeof payload.title === 'string' && 'score' in payload;
  return {
    id: row.id,
    type: row.type,
    channel: row.channel,
    status: row.status,
    jobId: row.jobId,
    title: isJob
      ? `${payload.title} — ${payload.company ?? ''}`.trim()
      : (payload.title ?? titleFor(row.type)),
    // The inbox shows the same text Telegram would, minus the markup.
    body: isJob
      ? stripTags(formatInstant(reviveAlert(payload as JobAlertData)))
      : (payload.detail ?? ''),
    score: typeof payload.score === 'number' ? payload.score : null,
    readAt: row.readAt?.toISOString() ?? null,
    sentAt: row.sentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function titleFor(type: string): string {
  return type === 'DIGEST' ? 'Daily digest' : type === 'SYSTEM' ? 'System alert' : 'JobSentinel';
}

function reviveAlert(job: JobAlertData): JobAlertData {
  return {
    ...job,
    postedAt: job.postedAt ? new Date(job.postedAt) : null,
    deadline: job.deadline ? new Date(job.deadline) : null,
  };
}

/** The web inbox renders text, never HTML (AGENTS.md §11). */
function stripTags(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
