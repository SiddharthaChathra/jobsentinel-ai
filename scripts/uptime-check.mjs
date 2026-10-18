#!/usr/bin/env node
// Uptime check with Telegram alerts (F11, D124) — run by .github/workflows/uptime.yml.
//
// Checks the API (/health/ready: up and reaching its database) and the worker (/health/worker:
// heartbeat within 2× the dispatch interval). Alerts on a CHANGE only: one message when it goes
// down, one when it recovers — not one every 15 minutes. Exits 1 while unhealthy, so the run's
// conclusion is the state the next run compares against.
//
//   API_BASE                  https://… (no trailing slash)
//   PREV_STATE                'healthy' | 'unhealthy' | '' (unknown: treated as healthy)
//   TELEGRAM_BOT_TOKEN        the bot's token (never printed)
//   ALERT_TELEGRAM_CHAT_ID    the owner's chat id; without it the check runs and nothing is sent
//   TELEGRAM_API              default https://api.telegram.org (a stub in tests)

const api = (process.env.API_BASE ?? '').replace(/\/$/, '');
if (!/^https?:\/\//.test(api)) {
  console.error('API_BASE must be an http(s) URL');
  process.exit(2);
}
const prev = process.env.PREV_STATE === 'unhealthy' ? 'unhealthy' : 'healthy';
const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
const chatId = process.env.ALERT_TELEGRAM_CHAT_ID ?? '';
const telegramApi = (process.env.TELEGRAM_API ?? 'https://api.telegram.org').replace(/\/$/, '');
// A sleeping Render instance takes 30-60 s to wake; allow it once before calling it down.
const TIMEOUT_MS = Number(process.env.CHECK_TIMEOUT_MS ?? 90_000);

async function check(path) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${api}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      let body = null;
      try {
        body = await res.json();
      } catch {
        /* a proxy error page is not JSON */
      }
      if (res.ok) return { ok: true, status: res.status, body };
      if (attempt === 2) return { ok: false, status: res.status, body };
    } catch (err) {
      if (attempt === 2) {
        return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
      }
    }
  }
  return { ok: false, status: 0 };
}

const ready = await check('/health/ready');
const worker = await check('/health/worker');
const healthy = ready.ok && worker.ok;
const state = healthy ? 'healthy' : 'unhealthy';

const describe = (name, r) =>
  r.ok
    ? `${name}: ok`
    : `${name}: ${r.status ? `HTTP ${r.status}` : (r.error ?? 'no answer')}${
        r.body?.status
          ? ` (${r.body.status}${r.body.ageMin != null ? `, last beat ${r.body.ageMin} min ago` : ''})`
          : ''
      }`;
const summary = `${describe('API', ready)} · ${describe('Worker', worker)}`;
console.warn(`${state} (previous: ${prev}) — ${summary}`);

let message = null;
if (!healthy && prev === 'healthy')
  message = `🔴 <b>JobSentinel is down</b>\n${escapeHtml(summary)}\n${escapeHtml(api)}`;
if (healthy && prev === 'unhealthy')
  message = `🟢 <b>JobSentinel recovered</b>\n${escapeHtml(summary)}`;

if (message) {
  if (!token || !chatId) {
    console.warn(
      '::warning::alert not sent: TELEGRAM_BOT_TOKEN or ALERT_TELEGRAM_CHAT_ID is not set',
    );
  } else {
    const res = await fetch(`${telegramApi}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    // Status only: the URL contains the token.
    console.warn(res.ok ? 'alert sent' : `::error::Telegram answered ${res.status}`);
    if (!res.ok) process.exitCode = 1;
  }
} else {
  console.warn('no change: no alert');
}

// exitCode, not process.exit(): exiting with fetch sockets still open crashes Node on Windows.
if (!healthy) process.exitCode = 1;

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
