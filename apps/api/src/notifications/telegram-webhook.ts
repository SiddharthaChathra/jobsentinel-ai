import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  Post,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Env } from '@jobsentinel/config';
import { ENV } from '../common/config/config.module';
import { Public } from '../common/decorators/public.decorator';
import { AppError } from '../common/errors/app-error';
import { TelegramClient, TelegramUpdateSchema } from './telegram.client';
import { TelegramPollerService } from './telegram-poller.service';

export const TELEGRAM_WEBHOOK_PATH = 'telegram/webhook';
const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

/**
 * The secret Telegram echoes on every webhook call. `TELEGRAM_WEBHOOK_SECRET` when set; otherwise
 * derived from the bot token, so a deployment that already holds the token needs no new secret —
 * whoever can forge it already controls the bot. Telegram allows `[A-Za-z0-9_-]`, 1-256 chars.
 */
export function webhookSecret(env: Env): string | null {
  if (env.TELEGRAM_WEBHOOK_SECRET) return env.TELEGRAM_WEBHOOK_SECRET;
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  return createHmac('sha256', env.TELEGRAM_BOT_TOKEN)
    .update('jobsentinel:telegram-webhook')
    .digest('base64url');
}

function sameSecret(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Receives bot updates pushed by Telegram (D98). This is what links a new user's chat: their
 * `/start <code>` arrives here. Long polling needs a process that never stops, and the worker
 * runs in short GitHub Actions bursts, so without this nobody could link Telegram.
 *
 * Public, because Telegram cannot hold a user's JWT; it is authenticated by the secret header
 * instead. Not throttled: Telegram is the only legitimate caller and paces itself.
 */
@Controller()
export class TelegramWebhookController {
  private readonly logger = new Logger(TelegramWebhookController.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly poller: TelegramPollerService,
  ) {}

  @Public()
  @SkipThrottle()
  @Post(TELEGRAM_WEBHOOK_PATH)
  @HttpCode(200)
  async receive(
    @Headers(SECRET_HEADER) secret: string | undefined,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const expected = this.env.TELEGRAM_MODE === 'webhook' ? webhookSecret(this.env) : null;
    if (!expected || !sameSecret(secret, expected)) {
      throw AppError.forbidden('Invalid webhook secret', 'TELEGRAM_WEBHOOK_FORBIDDEN');
    }
    const parsed = TelegramUpdateSchema.safeParse(body);
    if (!parsed.success) {
      // Still a 200: Telegram retries anything else, and a shape we cannot read never improves.
      this.logger.warn(`telegram webhook: ignored an unreadable update`);
      return { ok: true };
    }
    await this.poller.handleUpdates([parsed.data]);
    return { ok: true };
  }
}

/**
 * Registers the webhook with Telegram when the API starts (D98). Runs only in webhook mode, with
 * a bot token, on Render (`RENDER_EXTERNAL_URL` names the public address); locally, in tests and
 * in the worker it does nothing. A failure is logged, not thrown: the API still serves the site.
 */
@Injectable()
export class TelegramWebhookRegistrar implements OnApplicationBootstrap {
  private readonly logger = new Logger(TelegramWebhookRegistrar.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly telegram: TelegramClient,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.register();
  }

  async register(): Promise<boolean> {
    const base = this.env.RENDER_EXTERNAL_URL;
    const secret = webhookSecret(this.env);
    if (this.env.TELEGRAM_MODE !== 'webhook' || !base || !secret || !this.telegram.configured) {
      return false;
    }
    const url = `${base.replace(/\/$/, '')}/api/v1/${TELEGRAM_WEBHOOK_PATH}`;
    try {
      await this.telegram.setWebhook(url, secret);
      this.logger.log(`telegram webhook: registered ${url}`);
      return true;
    } catch (err) {
      this.logger.error(
        `telegram webhook: registration failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
}
