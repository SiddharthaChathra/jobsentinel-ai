import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { Env } from '@jobsentinel/config';
import { ENV } from '../common/config/config.module';
import { DB, type Db } from '../common/db/db.module';
import { notificationSettings, systemState, telegramLinks, users } from '../common/db/schema';
import { TrackerService } from '../jobs/tracker.service';
import { JobsDetailService } from '../jobs/jobs-detail.service';
import { DigestService } from './digest.service';
import { NotificationsService } from './notifications.service';
import { TelegramClient, type TelegramUpdate } from './telegram.client';

export interface PollResult {
  updates: number;
  linked: number;
  commands: number;
  callbacks: number;
  ignored: number;
}

/** Where the `getUpdates` offset is persisted, so a restart does not replay old messages. */
const OFFSET_KEY = 'telegram_update_offset';

/**
 * Long-polls the Bot API and handles linking, commands and inline buttons (docs 10 §4).
 *
 * Messages from chats we do not recognise are ignored rather than answered — an unlinked chat
 * must never be able to read or change anything.
 */
@Injectable()
export class TelegramPollerService {
  private readonly logger = new Logger(TelegramPollerService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly telegram: TelegramClient,
    private readonly tracker: TrackerService,
    private readonly jobsDetail: JobsDetailService,
    private readonly notifications: NotificationsService,
    private readonly digest: DigestService,
  ) {}

  async poll(opts: { timeoutSec?: number } = {}): Promise<PollResult> {
    const result: PollResult = { updates: 0, linked: 0, commands: 0, callbacks: 0, ignored: 0 };
    if (!this.telegram.configured || !this.env.TELEGRAM_POLLING) return result;

    const offset = await this.readOffset();
    const updates = await this.telegram.getUpdates(offset, opts.timeoutSec ?? 25);
    result.updates = updates.length;
    if (updates.length === 0) return result;

    for (const update of updates) {
      try {
        await this.handle(update, result);
      } catch (err) {
        this.logger.error(`update ${update.update_id} failed: ${String(err)}`);
      }
    }
    // Acknowledge past the highest id we have processed, even if some handler failed: replaying
    // a poisonous update forever would stall every later one.
    await this.writeOffset(Math.max(...updates.map((u) => u.update_id)) + 1);
    return result;
  }

  private async handle(update: TelegramUpdate, result: PollResult): Promise<void> {
    if (update.callback_query) {
      await this.onCallback(update.callback_query, result);
      return;
    }
    const message = update.message;
    if (!message?.text) {
      result.ignored++;
      return;
    }
    const chatId = BigInt(message.chat.id);
    const text = message.text.trim();

    const startMatch = /^\/start\s+(\S+)$/.exec(text);
    if (startMatch) {
      await this.onStart(chatId, startMatch[1]!, message.chat.username ?? null, result);
      return;
    }

    const userId = await this.userForChat(chatId);
    if (!userId) {
      result.ignored++;
      // One short reply so a stranger is not left staring at silence, but nothing is revealed.
      if (text.startsWith('/')) {
        await this.telegram
          .sendMessage({ chatId, text: 'This chat is not linked to a JobSentinel account.' })
          .catch(() => undefined);
      }
      return;
    }

    result.commands++;
    await this.onCommand(chatId, userId, text);
  }

  /** `/start <code>` — the only way a chat becomes linked (docs 10 §4). */
  private async onStart(
    chatId: bigint,
    code: string,
    username: string | null,
    result: PollResult,
  ): Promise<void> {
    const [link] = await this.db
      .select({ userId: telegramLinks.userId })
      .from(telegramLinks)
      .where(and(eq(telegramLinks.linkCode, code), gt(telegramLinks.linkCodeExpiresAt, new Date())))
      .limit(1);

    if (!link) {
      await this.telegram.sendMessage({
        chatId,
        text: 'That link code is invalid or has expired. Generate a new one in JobSentinel → Settings.',
      });
      result.ignored++;
      return;
    }

    // One chat per user, and one user per chat: re-linking replaces both sides.
    await this.db
      .delete(telegramLinks)
      .where(and(eq(telegramLinks.chatId, chatId), sql`${telegramLinks.userId} <> ${link.userId}`));
    await this.db
      .update(telegramLinks)
      .set({
        chatId,
        telegramUsername: username,
        linkedAt: new Date(),
        linkCode: null,
        linkCodeExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(telegramLinks.userId, link.userId));

    const [user] = await this.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, link.userId))
      .limit(1);
    result.linked++;
    await this.telegram.sendMessage({
      chatId,
      text: `✅ Linked to ${maskEmail(user?.email ?? '')}.\nYou will get alerts here. Send /help to see what I can do.`,
    });
  }

  private async onCommand(chatId: bigint, userId: string, text: string): Promise<void> {
    const [command, ...rest] = text.split(/\s+/);
    switch (command) {
      case '/help':
        await this.telegram.sendMessage({
          chatId,
          text: [
            '<b>JobSentinel</b>',
            '/status — worker, last scan, today’s counts',
            '/digest — send today’s digest now',
            '/pause 24h — mute alerts for a while',
            '/resume — unmute',
            '/help — this message',
          ].join('\n'),
        });
        return;
      case '/status':
        await this.telegram.sendMessage({ chatId, text: await this.statusText(userId) });
        return;
      case '/digest': {
        const r = await this.digest.sendDue({ userIds: [userId], force: true });
        await this.telegram.sendMessage({
          chatId,
          text:
            r.queued > 0
              ? 'Digest queued — it will arrive shortly.'
              : 'Today’s digest has already been sent.',
        });
        return;
      }
      case '/pause': {
        const hours = parseDuration(rest[0]);
        if (hours === null) {
          await this.telegram.sendMessage({ chatId, text: 'Usage: /pause 24h (or 30m, 2d)' });
          return;
        }
        const until = new Date(Date.now() + hours * 3_600_000);
        await this.db
          .update(notificationSettings)
          .set({ pausedUntil: until, updatedAt: new Date() })
          .where(eq(notificationSettings.userId, userId));
        await this.telegram.sendMessage({
          chatId,
          text: `🔕 Paused until ${until.toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
        });
        return;
      }
      case '/resume':
        await this.db
          .update(notificationSettings)
          .set({ pausedUntil: null, updatedAt: new Date() })
          .where(eq(notificationSettings.userId, userId));
        await this.telegram.sendMessage({ chatId, text: '🔔 Alerts resumed.' });
        return;
      default:
        await this.telegram.sendMessage({ chatId, text: 'Unknown command. Send /help.' });
    }
  }

  /** `Save` / `Not interested` buttons — routed through the same service the web UI uses. */
  private async onCallback(
    query: NonNullable<TelegramUpdate['callback_query']>,
    result: PollResult,
  ): Promise<void> {
    const chatId = query.message?.chat.id;
    const userId = chatId === undefined ? null : await this.userForChat(BigInt(chatId));
    if (!userId || !query.data) {
      await this.telegram.answerCallbackQuery(query.id, 'Not linked.');
      result.ignored++;
      return;
    }
    const [action, jobId] = query.data.split(':');
    if (!jobId) {
      await this.telegram.answerCallbackQuery(query.id);
      result.ignored++;
      return;
    }

    result.callbacks++;
    try {
      if (action === 'save') {
        await this.jobsDetail.setSaved(userId, jobId, true);
        await this.telegram.answerCallbackQuery(query.id, '⭐ Saved');
      } else if (action === 'skip') {
        await this.jobsDetail.notInterested(userId, jobId, 'Dismissed from Telegram');
        await this.telegram.answerCallbackQuery(query.id, '🚫 Marked not interested');
      } else {
        await this.telegram.answerCallbackQuery(query.id);
      }
    } catch (err) {
      this.logger.warn(`callback ${query.data} failed: ${String(err)}`);
      await this.telegram.answerCallbackQuery(query.id, 'Could not do that right now.');
    }
  }

  private async statusText(userId: string): Promise<string> {
    const [counts] = await this.db.execute<{
      new_today: number;
      matched: number;
      pending: number;
      last_scan: string | null;
      failing: number;
    }>(sql`
      select
        (select count(*) from jobs where first_seen_at >= now() - interval '24 hours')::int as new_today,
        (select count(*) from job_matches where user_id = ${userId})::int as matched,
        (select count(*) from notifications where user_id = ${userId} and status = 'PENDING')::int as pending,
        (select max(last_successful_scan)::text from job_sources) as last_scan,
        (select count(*) from job_sources where status in ('FAILING','DISABLED'))::int as failing
    `);
    return [
      '<b>JobSentinel status</b>',
      `🆕 New jobs in 24 h: ${counts?.new_today ?? 0}`,
      `🎯 Scored for you: ${counts?.matched ?? 0}`,
      `📨 Queued alerts: ${counts?.pending ?? 0}`,
      `🕒 Last successful scan: ${counts?.last_scan ?? 'never'}`,
      `⚠️ Sources failing: ${counts?.failing ?? 0}`,
    ].join('\n');
  }

  private async userForChat(chatId: bigint): Promise<string | null> {
    const [row] = await this.db
      .select({ userId: telegramLinks.userId })
      .from(telegramLinks)
      .where(eq(telegramLinks.chatId, chatId))
      .limit(1);
    return row?.userId ?? null;
  }

  private async readOffset(): Promise<number> {
    const [row] = await this.db
      .select({ value: systemState.value })
      .from(systemState)
      .where(eq(systemState.key, OFFSET_KEY))
      .limit(1);
    const parsed = Number((row?.value as { offset?: number } | undefined)?.offset ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private async writeOffset(offset: number): Promise<void> {
    await this.db
      .insert(systemState)
      .values({ key: OFFSET_KEY, value: { offset } })
      .onConflictDoUpdate({
        target: systemState.key,
        set: { value: { offset }, updatedAt: new Date() },
      });
  }
}

function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!name || !domain) return 'your account';
  const head = name.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(name.length - 2, 1))}@${domain}`;
}

/** "24h" | "30m" | "2d" → hours. */
function parseDuration(input: string | undefined): number | null {
  if (!input) return null;
  const m = /^(\d+)\s*([hmd])$/i.exec(input.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  if (n <= 0) return null;
  const hours = unit === 'm' ? n / 60 : unit === 'd' ? n * 24 : n;
  return hours > 24 * 30 ? null : hours;
}
