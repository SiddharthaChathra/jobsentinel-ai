import { loadEnv } from '@jobsentinel/config';
import { AppError } from '../common/errors/app-error';
import { type TelegramClient, TelegramError, type TelegramUpdate } from './telegram.client';
import { TelegramPollerService } from './telegram-poller.service';
import {
  TelegramWebhookController,
  TelegramWebhookRegistrar,
  webhookSecret,
} from './telegram-webhook';

const TOKEN = '123456:test-token';
const webhookEnv = (extra: Record<string, string> = {}) =>
  loadEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_MODE: 'webhook', ...extra });

const startUpdate = {
  update_id: 7,
  message: { message_id: 1, chat: { id: 42, type: 'private' }, text: '/start abc' },
};

function fakePoller() {
  const seen: TelegramUpdate[][] = [];
  const poller = {
    handleUpdates: (updates: TelegramUpdate[]) => {
      seen.push(updates);
      return Promise.resolve({
        updates: updates.length,
        linked: 0,
        commands: 0,
        callbacks: 0,
        ignored: 0,
      });
    },
  } as unknown as TelegramPollerService;
  return { poller, seen };
}

describe('webhookSecret (D98)', () => {
  it('prefers TELEGRAM_WEBHOOK_SECRET', () => {
    expect(webhookSecret(webhookEnv({ TELEGRAM_WEBHOOK_SECRET: 'explicit_secret' }))).toBe(
      'explicit_secret',
    );
  });

  it('otherwise derives a stable, Telegram-safe secret from the bot token', () => {
    const a = webhookSecret(webhookEnv());
    expect(a).toMatch(/^[A-Za-z0-9_-]{20,256}$/);
    expect(webhookSecret(webhookEnv())).toBe(a);
    expect(webhookSecret(webhookEnv({ TELEGRAM_BOT_TOKEN: '999:other' }))).not.toBe(a);
    expect(a).not.toContain(TOKEN);
  });

  it('is null without a bot', () => {
    expect(webhookSecret(loadEnv({}))).toBeNull();
  });
});

describe('TelegramWebhookController (D98)', () => {
  it('hands a correctly signed update to the shared handler', async () => {
    const env = webhookEnv();
    const { poller, seen } = fakePoller();
    const ctl = new TelegramWebhookController(env, poller);
    await expect(ctl.receive(webhookSecret(env)!, startUpdate)).resolves.toEqual({ ok: true });
    expect(seen).toEqual([[startUpdate]]);
  });

  it.each([
    ['a missing secret', undefined],
    ['a wrong secret', 'not-the-secret'],
  ])('rejects %s without touching the handler', async (_label, secret) => {
    const { poller, seen } = fakePoller();
    const ctl = new TelegramWebhookController(webhookEnv(), poller);
    await expect(ctl.receive(secret, startUpdate)).rejects.toBeInstanceOf(AppError);
    expect(seen).toHaveLength(0);
  });

  it('is closed in polling mode, even with the right secret', async () => {
    const env = loadEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_MODE: 'polling' });
    const { poller, seen } = fakePoller();
    const ctl = new TelegramWebhookController(env, poller);
    await expect(ctl.receive(webhookSecret(env)!, startUpdate)).rejects.toBeInstanceOf(AppError);
    expect(seen).toHaveLength(0);
  });

  it('acknowledges an unreadable body instead of making Telegram retry it', async () => {
    const env = webhookEnv();
    const { poller, seen } = fakePoller();
    const ctl = new TelegramWebhookController(env, poller);
    await expect(ctl.receive(webhookSecret(env)!, { hello: 'world' })).resolves.toEqual({
      ok: true,
    });
    expect(seen).toHaveLength(0);
  });
});

describe('TelegramWebhookRegistrar (D98)', () => {
  function fakeTelegram(fail = false) {
    const calls: { url: string; secret: string }[] = [];
    const telegram = {
      configured: true,
      setWebhook: (url: string, secret: string) => {
        calls.push({ url, secret });
        return fail ? Promise.reject(new Error('boom')) : Promise.resolve();
      },
    } as unknown as TelegramClient;
    return { telegram, calls };
  }

  it('registers the public API address with the secret on Render', async () => {
    const env = webhookEnv({ RENDER_EXTERNAL_URL: 'https://api.example.com/' });
    const { telegram, calls } = fakeTelegram();
    await expect(new TelegramWebhookRegistrar(env, telegram).register()).resolves.toBe(true);
    expect(calls).toEqual([
      { url: 'https://api.example.com/api/v1/telegram/webhook', secret: webhookSecret(env) },
    ]);
  });

  it.each([
    ['polling mode', { TELEGRAM_MODE: 'polling', RENDER_EXTERNAL_URL: 'https://api.example.com' }],
    ['no public address (local, worker, tests)', {}],
  ])('does nothing in %s', async (_label, extra) => {
    const { telegram, calls } = fakeTelegram();
    await expect(
      new TelegramWebhookRegistrar(webhookEnv(extra), telegram).register(),
    ).resolves.toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('logs a failed registration instead of stopping the API', async () => {
    const env = webhookEnv({ RENDER_EXTERNAL_URL: 'https://api.example.com' });
    const { telegram } = fakeTelegram(true);
    await expect(new TelegramWebhookRegistrar(env, telegram).register()).resolves.toBe(false);
  });
});

describe('TelegramPollerService in webhook mode (D98)', () => {
  it('never calls getUpdates, which Telegram refuses while a webhook is set', async () => {
    const getUpdates = jest.fn();
    const telegram = { configured: true, getUpdates } as unknown as TelegramClient;
    const poller = new TelegramPollerService(
      {} as never,
      webhookEnv({ TELEGRAM_POLLING: 'true' }),
      telegram,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(poller.poll()).resolves.toMatchObject({ updates: 0 });
    expect(getUpdates).not.toHaveBeenCalled();
  });

  it('stands down when a local poller meets the deployed webhook (409), instead of failing', async () => {
    const getUpdates = jest
      .fn()
      .mockRejectedValue(new TelegramError('getUpdates: Conflict: webhook is active', 409));
    const telegram = { configured: true, getUpdates } as unknown as TelegramClient;
    const noRows = { from: () => noRows, where: () => noRows, limit: () => Promise.resolve([]) };
    const db = { select: () => noRows };
    const poller = new TelegramPollerService(
      db as never,
      loadEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_MODE: 'polling', TELEGRAM_POLLING: 'true' }),
      telegram,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(poller.poll({ timeoutSec: 1 })).resolves.toMatchObject({ updates: 0 });
    expect(getUpdates).toHaveBeenCalledTimes(1);
  });
});
