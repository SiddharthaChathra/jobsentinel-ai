import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Env } from '@jobsentinel/config';
import { z } from 'zod';
import { ENV } from '../common/config/config.module';
import type { HttpClientPort } from '../common/http/http-client';
import { HTTP_CLIENT } from '../common/http/http.module';

const API_BASE = 'https://api.telegram.org';
/** Telegram allows ~30 messages/second overall; 1/s is far inside it and never trips a limit. */
const GLOBAL_GAP_MS = 1_000;

export interface InlineButton {
  text: string;
  /** A URL button opens a link; a callback button sends `callback_data` back to the poller. */
  url?: string;
  callbackData?: string;
}

export interface SendMessageInput {
  chatId: bigint | string;
  text: string;
  buttons?: InlineButton[][];
  disablePreview?: boolean;
}

/**
 * The slice of a Bot API update the bot acts on. Parsed with Zod because, with a webhook, it is an
 * HTTP body from the internet; unknown fields are ignored, not rejected, as Telegram adds them.
 */
export const TelegramUpdateSchema = z.object({
  update_id: z.number().int(),
  message: z
    .object({
      message_id: z.number().int(),
      chat: z.object({ id: z.number().int(), username: z.string().optional(), type: z.string() }),
      from: z.object({ id: z.number().int(), username: z.string().optional() }).optional(),
      text: z.string().optional(),
    })
    .optional(),
  callback_query: z
    .object({
      id: z.string(),
      data: z.string().optional(),
      from: z.object({ id: z.number().int(), username: z.string().optional() }),
      message: z.object({ chat: z.object({ id: z.number().int() }) }).optional(),
    })
    .optional(),
});
export type TelegramUpdate = z.infer<typeof TelegramUpdateSchema>;

export class TelegramError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Set on 429: Telegram tells us exactly how long to wait. */
    readonly retryAfterSec?: number,
    /** True when the user blocked the bot or the chat no longer exists — retrying cannot help. */
    readonly permanent = false,
  ) {
    super(message);
    this.name = 'TelegramError';
  }
}

interface TelegramEnvelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

/**
 * Bot API client (docs 10 §1). Plain `fetch` through `HttpClient` — no SDK, so there is one
 * outbound path with the SSRF guard, timeouts and body caps already applied (AGENTS.md §12).
 *
 * `null` token means Telegram is simply not configured: callers fall back to the web inbox
 * rather than failing, exactly as an absent AI provider does.
 */
@Injectable()
export class TelegramClient {
  private readonly logger = new Logger(TelegramClient.name);
  private lastSentAt = 0;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(HTTP_CLIENT) private readonly http: HttpClientPort,
  ) {}

  get configured(): boolean {
    return Boolean(this.env.TELEGRAM_BOT_TOKEN);
  }

  get botUsername(): string | null {
    return this.env.TELEGRAM_BOT_USERNAME ?? null;
  }

  /** `https://t.me/<bot>?start=<code>` — the deep link that links an account (docs 10 §4). */
  linkUrl(code: string): string | null {
    return this.botUsername ? `https://t.me/${this.botUsername}?start=${code}` : null;
  }

  async sendMessage(input: SendMessageInput): Promise<{ messageId: number }> {
    const body: Record<string, unknown> = {
      chat_id: String(input.chatId),
      text: input.text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: input.disablePreview ?? true },
    };
    if (input.buttons?.length) {
      body.reply_markup = {
        inline_keyboard: input.buttons.map((row) =>
          row.map((b) =>
            b.url
              ? { text: b.text, url: b.url }
              : { text: b.text, callback_data: b.callbackData ?? '' },
          ),
        ),
      };
    }
    const result = await this.call<{ message_id: number }>('sendMessage', body);
    return { messageId: result.message_id };
  }

  /**
   * Long poll (docs 10 §1). `timeoutSec` is Telegram's own hold-open time; the HTTP timeout is
   * deliberately longer so the client never aborts a poll Telegram is still holding.
   */
  async getUpdates(offset: number, timeoutSec = 25): Promise<TelegramUpdate[]> {
    return this.call<TelegramUpdate[]>(
      'getUpdates',
      { offset, timeout: timeoutSec, allowed_updates: ['message', 'callback_query'] },
      { timeoutMs: (timeoutSec + 10) * 1_000, skipRateLimit: true },
    );
  }

  /**
   * Points the bot at an HTTPS endpoint (docs 10 §1). Telegram then pushes every update there,
   * sending `secretToken` in a header, and refuses `getUpdates` while the webhook is set.
   */
  async setWebhook(url: string, secretToken: string): Promise<void> {
    await this.call<boolean>(
      'setWebhook',
      {
        url,
        secret_token: secretToken,
        allowed_updates: ['message', 'callback_query'],
        // Commands typed while the API was being redeployed are still answered, once.
        drop_pending_updates: false,
      },
      { skipRateLimit: true },
    );
  }

  /** Stops the button's spinner in the client; the toast text is optional. */
  async answerCallbackQuery(id: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', {
      callback_query_id: id,
      ...(text ? { text } : {}),
    }).catch((err: unknown) => {
      // A stale callback id is not worth failing an action the user already asked for.
      this.logger.debug(`answerCallbackQuery ignored: ${String(err)}`);
    });
  }

  async getMe(): Promise<{ id: number; username?: string }> {
    return this.call<{ id: number; username?: string }>('getMe', {}, { skipRateLimit: true });
  }

  private async call<T>(
    method: string,
    body: Record<string, unknown>,
    opts: { timeoutMs?: number; skipRateLimit?: boolean } = {},
  ): Promise<T> {
    const token = this.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new TelegramError('Telegram is not configured', 0, undefined, true);
    if (!opts.skipRateLimit) await this.pace();

    const res = await this.http.request(`${API_BASE}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: opts.timeoutMs ?? 15_000,
      // Telegram is rate-limited by us, not by retrying: a 429 carries `retry_after`.
      retries: 0,
      skipPoliteness: true,
    });

    let envelope: TelegramEnvelope<T>;
    try {
      envelope = JSON.parse(res.text) as TelegramEnvelope<T>;
    } catch {
      throw new TelegramError(`${method}: unparseable response (HTTP ${res.status})`, res.status);
    }
    if (!envelope.ok || envelope.result === undefined) {
      const description = envelope.description ?? `HTTP ${res.status}`;
      throw new TelegramError(
        `${method}: ${description}`,
        envelope.error_code ?? res.status,
        envelope.parameters?.retry_after,
        isPermanent(envelope.error_code ?? res.status, description),
      );
    }
    return envelope.result;
  }

  /** One message per second, process-wide (docs 10 §5). */
  private async pace(): Promise<void> {
    const wait = this.lastSentAt + GLOBAL_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastSentAt = Date.now();
  }
}

/**
 * Distinguishes "will never succeed" from "try again later". Retrying a blocked bot or a deleted
 * chat forever would burn the queue and look like an outage.
 */
function isPermanent(code: number, description: string): boolean {
  if (code === 403) return true; // bot blocked / kicked
  if (code === 401) return true; // bad token
  if (code !== 400) return false;
  return /chat not found|user is deactivated|chat_id is empty|bot was blocked/i.test(description);
}
