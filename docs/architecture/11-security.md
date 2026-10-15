# 11 — Security & Privacy Architecture

## 1. Threat model (personal system, public internet)

Assets: resume text and profile (PII), Supabase service key, AI keys, Telegram bot token, the user's job pipeline integrity. Threats: credential leakage (git, frontend bundle, logs), account takeover, SSRF via attacker-controlled job URLs, malicious HTML/JS in job descriptions (XSS), abuse of the API (rate limits), prompt injection via job descriptions into AI calls, unwanted data retention by AI providers.

## 2. Controls

### Authentication & authorization

- Supabase Auth issues JWTs; API verifies signature (JWKS, cached, key rotation tolerant), `exp`, `aud`, `iss`. No custom password handling anywhere.
- Sign-up gate: `ALLOWED_SIGNUP_EMAILS` (comma list or `*`) enforced at bootstrap; disallowed users get 403 and no rows created. The deployed instance is open (`*`, D93), so anything every account shares is capped per user: AI resume analyses (5 per rolling 24 h, then the deterministic draft), stored resumes (10), and the API's request throttles.
- Ownership check in every service (`user_id = currentUser.id`); admin-only routes (`sources`, `companies`, `system/logs`) behind `AdminGuard` (`users.is_admin`, set for the first user / `ADMIN_EMAILS`).
- RLS enabled on all user-owned tables (defense in depth; doc 02 §6).
- Supabase **anon key** is the only key in the browser; **service role key** exists only in API/worker env.

### Secrets

- `.env.example` committed with placeholders; `.env*` git-ignored; `gitleaks` pre-commit hook (free) + GitHub secret scanning.
- `packages/config` validates env at boot; secrets are never logged (pino redact paths).
- Telegram bot token, AI keys, Adzuna keys: worker/API only.

### Input validation & API hardening

- Zod on every body/query/param; `helmet`; CORS restricted to `WEB_ORIGIN`; JSON body limit 1 MB; multipart limit 5 MB; `@nestjs/throttler` (per-user + per-IP).
- File uploads: extension + MIME + magic bytes (`%PDF-`, ZIP signature for DOCX), size ≤ 5 MB, filename sanitized, stored under a server-generated path; never executed or served inline (signed URL, `Content-Disposition: attachment`).

### SSRF & outbound safety (worker/API fetch anything from job sources)

- `HttpClient` resolves DNS first and refuses private/loopback/link-local/metadata ranges (`10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, ::1, fc00::/7`), re-checks on every redirect hop, allows only `http/https`, caps body size and time, and never sends credentials/cookies.
- Job/apply URLs are rendered in the UI as `rel="noopener noreferrer nofollow"`, `target=_blank`, and are shown fully (host highlighted) before the user clicks.

### XSS / content safety

- Job descriptions are sanitized server-side (`sanitize-html` allowlist: p, ul, ol, li, b, strong, em, br, h3–h5, a[href http(s)]) **and** stored as text for search; the UI never uses `dangerouslySetInnerHTML` on unsanitized data.
- CSP on the web app (Next.js headers): `default-src 'self'`, Supabase + API origins allowlisted, no inline scripts except Next nonce.

### Prompt injection

- Job text is placed in a clearly delimited user block; system prompts instruct to treat it as data; outputs are Zod-validated and bounded (AI can't produce free-form actions). The AI never receives tool/agent capabilities.

### Privacy

- Resume file: private bucket, per-user path, signed URLs (60 s). Extracted text: DB only, excluded from logs and API responses by default.
- AI: redacted text (emails, phones, addresses, URLs replaced with tokens), minimal job fields; provider and model recorded per call; user can select provider or local model; `docs/ai.md` documents each provider's data-use policy and how to opt out (e.g. Claude API does not train on API data by default; Gemini API free tier terms differ — user is warned in Settings).
- Never send resume text to Telegram; never expose profile publicly; no analytics/trackers in the web app.
- "Delete my data" in Settings: removes resumes (storage + rows), profile, matches, notifications, tracker; jobs/companies (non-personal) remain.

### Operational

- Dependencies pinned via `pnpm-lock.yaml`; `pnpm audit` in CI (non-blocking on low).
- Health endpoints expose no secrets; `/api/docs` off in prod by default.
- Backups: Supabase free has no PITR — worker runs a weekly `pg_dump` (via `DATABASE_URL`) to a local/VM path or a private GitHub release asset (encrypted with `age`) — documented in deployment.

## 3. Security review checklist (used at Phase 12 and by `/security-review`)

- [ ] No secret in `apps/web` bundle (`NEXT_PUBLIC_*` limited to Supabase URL/anon key, API URL, bot username)
- [ ] All routes authenticated except `/health*`
- [ ] Ownership filters present in every repository method taking a user id
- [ ] SSRF guard covers redirects
- [ ] Sanitizer allowlist unchanged
- [ ] Rate limits present on upload/scan/test-notification routes
- [ ] Logs redact tokens, resume text, emails
