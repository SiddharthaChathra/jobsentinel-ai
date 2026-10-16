# Notifications (live reference)

Design: [architecture/10-notifications.md](architecture/10-notifications.md). This page documents what is implemented and how to operate it.

Two channels carry the same alert: **Telegram** for the push, and the **web inbox** as the complete record. The inbox is written first and is never skipped, so an alert exists even when Telegram is unlinked, throttled or down.

## The two guarantees

1. **Never notify twice for the same job.** `notifications` is unique on `(user_id, job_id, channel, type)` and every insert is `ON CONFLICT DO NOTHING`. Re-matching after a profile edit, a re-validation or a worker restart cannot produce a second alert — the database refuses it, not the code.
2. **Never lose an alert.** The row is written before any network call. Delivery failure reschedules it (1 m → 5 m → 30 m → 2 h → 12 h) and only then marks it `FAILED`, still visible in the inbox.

## Who gets alerted, and when

`decideNotification` in `packages/validation/src/notify/decide.ts` is pure and unit-tested. In order:

| Condition                                  | Outcome                                         |
| ------------------------------------------ | ----------------------------------------------- |
| mode `DISABLED`, or paused                 | nothing                                         |
| validation `NEEDS_REVIEW` / `SUSPICIOUS`   | **digest only**, and only if the user opted in  |
| validation not `VALID` (expired, rejected) | nothing                                         |
| mode `DIGEST`                              | digest                                          |
| score below `instant_min_score`            | digest                                          |
| first seen more than 48 h ago              | digest — instant alerts are for new discoveries |
| inside quiet hours                         | instant, **delayed** to the end of the window   |
| otherwise                                  | instant, immediately                            |

An unconfirmed job is never pushed. That is the whole point of the validation phase: a posting that arrives as an alert carries a verification line, and one we could not confirm waits for the digest where it is labelled.

Quiet hours and the digest hour are evaluated in the user's own timezone, including windows that cross midnight and days that change length under DST.

## Message shape

Every alert carries its evidence, never a bare score:

```
🚨 NEW FRESHER JOB — Software Engineer
🏢 Razorpay · 📍 Bengaluru · 🧑‍🎓 0–1 yrs · Fresher ✓
🎯 Match 91% — Very High
✓ Python ✓ SQL ✓ Linux · ✗ Kubernetes
🛡 Company verified · Apply link verified · (jobs.lever.co)
🕒 Posted 2 h ago · Deadline: 30 Sep
[ 🔗 APPLY NOW ] [ 📊 View ]
[ ⭐ Save ] [ 🚫 Not interested ]
```

All employer-supplied text is HTML-escaped: an unescaped `<` in a job title would otherwise truncate the message. `APPLY NOW` points at the probed final URL — the one validation confirmed actually resolves. `Save` and `Not interested` route through the same services the web UI uses, so the two stay consistent.

Button URLs must be publicly reachable or Telegram rejects the entire message, so a `localhost` dashboard silently loses the "View" button rather than the alert (D56).

## Linking a Telegram account

1. `POST /telegram/link` returns `https://t.me/<bot>?start=<code>`, valid 15 minutes.
2. The user opens it; the bot receives `/start <code>`; the API stores the chat id and confirms with a masked email. In production Telegram pushes it to `POST /api/v1/telegram/webhook`, checked against a secret header (D98).
3. One chat per user, one user per chat — re-linking replaces both sides. Messages from unlinked chats are ignored.

Bot commands: `/status`, `/digest`, `/pause 24h`, `/resume`, `/help`. There is deliberately no free-text AI chat in the bot.

## Operating it

```bash
pnpm --filter @jobsentinel/api notify            # decide + deliver
pnpm --filter @jobsentinel/api notify --digest   # force today's digest
pnpm --filter @jobsentinel/api notify --dispatch-only
pnpm --filter @jobsentinel/api notify --user=<uuid>
```

The worker runs the same four stages every tick: `notify` → `dispatch` → `digest` → `telegram` (long poll; skipped in webhook mode). Each is isolated, so a Telegram outage cannot stop scanning.

Every alert goes to the chat linked to _that_ user (`telegram_links.user_id`): each account links its own Telegram, and one user never sees another's alerts.

Env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_POLLING`, `TELEGRAM_MODE` (`webhook` in production: the API registers `RENDER_EXTERNAL_URL/api/v1/telegram/webhook` on boot), `TELEGRAM_WEBHOOK_SECRET` (optional; derived from the bot token when unset). With no token the system runs normally and writes only to the web inbox.

## Verified live

On 2026-09-23, four real alerts were delivered to a real Telegram account for four real validated jobs, top match Thoughtworks "Developer (Vapasi) – Intern" at 98 %, each with a working APPLY button pointing at the employer's application page.

## Limits worth knowing

- Sending is paced to one message per second globally; Telegram's own `retry_after` is honoured on 429.
- A blocked bot or deleted chat fails permanently rather than retrying forever.
- System alerts are rate-limited to one per type per 6 hours, so a flapping source cannot become a stream.
- Alerts contain job data only — never resume content (docs 10 §7).
