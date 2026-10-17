import { z } from 'zod';

/**
 * Single source of truth for every environment variable used by the API, worker and web app.
 * Nothing else in the codebase reads `process.env` directly.
 *
 * Every variable is optional at the schema level (with a default where sensible) so that each
 * process can boot with only what it needs; modules call `assertEnv(env, [...keys])` at startup
 * to fail fast with a readable list of what is missing.
 */

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const bool = (defaultValue: boolean) =>
  z.preprocess((v) => {
    v = emptyToUndefined(v);
    if (v === undefined) return defaultValue;
    if (typeof v !== 'string') return v; // let zod produce the error
    const s = v.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(s)) return true;
    if (['0', 'false', 'no', 'off'].includes(s)) return false;
    return v;
  }, z.boolean());

const int = (defaultValue: number, opts: { min?: number; max?: number } = {}) =>
  z.preprocess(
    (v) => {
      v = emptyToUndefined(v);
      if (v === undefined) return defaultValue;
      if (typeof v !== 'string') return v;
      const n = Number(v);
      return Number.isFinite(n) ? n : v;
    },
    z
      .number()
      .int()
      .min(opts.min ?? 0)
      .max(opts.max ?? Number.MAX_SAFE_INTEGER),
  );

const optStr = () => z.preprocess(emptyToUndefined, z.string().min(1).optional());
const optUrl = () => z.preprocess(emptyToUndefined, z.url().optional());
const strDefault = (d: string) => z.preprocess(emptyToUndefined, z.string().min(1).default(d));
const urlDefault = (d: string) => z.preprocess(emptyToUndefined, z.url().default(d));

/**
 * A site address as people paste it — `example.com`, `https://example.com/`, ` https://x.com/a ` —
 * reduced to the bare origin (`https://example.com`), or null when it is not an http(s) address.
 *
 * Origins are compared byte-for-byte by browsers, so `https://site/` (trailing slash) silently
 * blocks every CORS request, and a value without a scheme failed validation and stopped the API
 * from booting at all on Render (D89).
 */
export function toOrigin(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

const originDefault = (d: string) =>
  z.preprocess(
    emptyToUndefined,
    z
      .string()
      .default(d)
      .transform((s, ctx) => {
        const origin = toOrigin(s);
        if (origin) return origin;
        ctx.addIssue({ code: 'custom', message: `not a web address: "${s}"` });
        return z.NEVER;
      }),
  );

/** Comma-separated origins (e.g. the deployed site and localhost), each normalized by `toOrigin`. */
const originList = (d: string) =>
  z.preprocess(
    emptyToUndefined,
    z
      .string()
      .default(d)
      .transform((s, ctx) => {
        const parts = s.split(',').filter((p) => p.trim() !== '');
        const origins = parts.map(toOrigin);
        const bad = parts.filter((_, i) => origins[i] === null);
        if (bad.length > 0 || parts.length === 0) {
          ctx.addIssue({ code: 'custom', message: `not a web address: "${bad.join('", "')}"` });
          return z.NEVER;
        }
        return [...new Set(origins as string[])];
      }),
  );

/** `*` (anyone) or a deduplicated, lowercased list of emails. */
export type EmailList = '*' | string[];

export function parseEmailList(raw: string | undefined): EmailList {
  if (raw === undefined || raw.trim() === '') return [];
  if (raw.trim() === '*') return '*';
  const list = raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
  return Array.from(new Set(list));
}

const emailList = (defaultValue: EmailList) =>
  z.preprocess(
    (v) => {
      v = emptyToUndefined(v);
      if (v === undefined) return defaultValue;
      return typeof v === 'string' ? parseEmailList(v) : v;
    },
    z.union([z.literal('*'), z.array(z.email())]),
  );

export const AI_PROVIDERS = ['gemini', 'claude', 'local'] as const;
export type AIProviderName = (typeof AI_PROVIDERS)[number];

export const envSchema = z
  .object({
    // ── Shared ──────────────────────────────────────────────────────────────
    NODE_ENV: z.preprocess(
      emptyToUndefined,
      z.enum(['development', 'test', 'production']).default('development'),
    ),
    APP_BASE_URL: originDefault('http://localhost:3000'),
    API_BASE_URL: urlDefault('http://localhost:4000'),
    LOG_LEVEL: z.preprocess(
      emptyToUndefined,
      z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    ),

    // ── Supabase ────────────────────────────────────────────────────────────
    SUPABASE_URL: optUrl(),
    SUPABASE_ANON_KEY: optStr(),
    SUPABASE_SERVICE_ROLE_KEY: optStr(),
    SUPABASE_JWT_ISSUER: optUrl(),
    DATABASE_URL: optStr(),
    DATABASE_DIRECT_URL: optStr(),
    RESUME_BUCKET: strDefault('resumes'),

    // ── API ─────────────────────────────────────────────────────────────────
    PORT: int(4000, { min: 1, max: 65535 }),
    // Browser origins allowed by CORS: comma-separated, e.g. the Vercel URL and localhost (D89).
    WEB_ORIGIN: originList('http://localhost:3000'),
    // Set by Render itself to the service's public URL; turns on the keep-awake ping (D94).
    RENDER_EXTERNAL_URL: optUrl(),
    // Local hours the keep-awake ping runs, "start-end" (end exclusive, may wrap past midnight).
    // Outside them the free instance may sleep, which saves Render's shared free hours (D99).
    // Source auto-pause (F2, D104): pause only after this many collected jobs with none kept,
    // over this many days. India-scoped sources are alerted on, never paused.
    // Off: decisions are logged (and India-scoped alerts still sent) but nothing is paused —
    // for reviewing the list before the first live run (D104).
    AUTO_PAUSE_ENABLED: bool(true),
    AUTO_PAUSE_MIN_COLLECTED: int(20, { min: 1, max: 10_000 }),
    AUTO_PAUSE_WINDOW_DAYS: int(30, { min: 7, max: 180 }),
    KEEP_AWAKE_HOURS: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .regex(/^([01]?\d|2[0-4])-([01]?\d|2[0-4])$/, 'expected "HH-HH", e.g. 7-24')
        .default('0-24'),
    ),
    KEEP_AWAKE_TZ: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .refine((tz) => {
          try {
            new Intl.DateTimeFormat('en', { timeZone: tz });
            return true;
          } catch {
            return false;
          }
        }, 'unknown IANA time zone')
        .default('Asia/Kolkata'),
    ),
    // Optional: the API starts the GitHub-hosted worker on its own clock (D95). A fine-grained
    // token limited to "Actions: read and write" on this repository; unset = off.
    WORKER_DISPATCH_TOKEN: optStr(),
    WORKER_DISPATCH_REPO: strDefault('SiddharthaChathra/jobsentinel-ai'),
    WORKER_DISPATCH_INTERVAL_MIN: int(30, { min: 10, max: 1440 }),
    ALLOWED_SIGNUP_EMAILS: emailList('*'),
    ADMIN_EMAILS: emailList([]),
    ENABLE_API_DOCS: bool(false),
    RATE_LIMIT_PER_MIN: int(120, { min: 1 }),

    // ── Worker ──────────────────────────────────────────────────────────────
    WORKER_TICK_MS: int(60_000, { min: 1_000 }),
    WORKER_MAX_SOURCES_PER_TICK: int(3, { min: 1 }),
    WORKER_SOURCE_CONCURRENCY: int(2, { min: 1 }),
    SOURCE_SCAN_TIMEOUT_MS: int(600_000, { min: 5_000 }),
    HTTP_USER_AGENT: strDefault('JobSentinelAI/0.1 (+https://github.com/jobsentinel-ai)'),
    HTTP_TIMEOUT_MS: int(15_000, { min: 1_000 }),
    WORKER_HEALTH_PORT: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(65535).optional(),
    ),
    TELEGRAM_POLLING: bool(true),

    // ── AI ──────────────────────────────────────────────────────────────────
    AI_PROVIDER: z.preprocess(emptyToUndefined, z.enum(AI_PROVIDERS).default('gemini')),
    AI_FALLBACK_PROVIDERS: z.preprocess(
      (v) => {
        v = emptyToUndefined(v);
        if (v === undefined) return [];
        if (typeof v !== 'string') return v;
        return v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      },
      z.array(z.enum(AI_PROVIDERS)),
    ),
    AI_GEMINI_API_KEY: optStr(),
    AI_GEMINI_MODEL: strDefault('gemini-3.5-flash-lite'),
    AI_CLAUDE_API_KEY: optStr(),
    AI_CLAUDE_MODEL: strDefault('claude-haiku-4-5'),
    AI_LOCAL_BASE_URL: urlDefault('http://localhost:11434'),
    AI_LOCAL_MODEL: strDefault('llama3.1'),
    AI_REQUEST_TIMEOUT_MS: int(20_000, { min: 1_000 }),
    /** Minimum gap between AI calls. Gemini free tier allows 15/min; 4.5 s stays under it. */
    AI_MIN_REQUEST_GAP_MS: int(4_500, { min: 0 }),
    AI_DAILY_CALL_BUDGET: int(500, { min: 0 }),
    AI_DAILY_TOKEN_BUDGET: int(1_500_000, { min: 0 }),
    /**
     * Daily AI calls made for one user (matching and its requirement extraction), so no single
     * account can spend the budget all users share (F8, D112). Resume parsing has its own cap.
     */
    AI_USER_DAILY_CALL_LIMIT: int(100, { min: 1 }),
    AI_ALLOW_DETERMINISTIC_ALERTS: bool(true),

    // ── Notifications ───────────────────────────────────────────────────────
    TELEGRAM_BOT_TOKEN: optStr(),
    TELEGRAM_BOT_USERNAME: optStr(),
    TELEGRAM_MODE: z.preprocess(
      emptyToUndefined,
      z.enum(['polling', 'webhook']).default('polling'),
    ),
    TELEGRAM_WEBHOOK_SECRET: optStr(),

    // ── Sources ─────────────────────────────────────────────────────────────
    ADZUNA_APP_ID: optStr(),
    ADZUNA_APP_KEY: optStr(),
    // Adzuna's published API quota (developer.adzuna.com terms, checked 2026-10-17); the scan path
    // refuses any scan that would take a rolling window past QUOTA_SAFETY of it (D108).
    ADZUNA_LIMIT_PER_MINUTE: int(25, { min: 1 }),
    ADZUNA_LIMIT_PER_DAY: int(250, { min: 1 }),
    ADZUNA_LIMIT_PER_WEEK: int(1000, { min: 1 }),
    ADZUNA_LIMIT_PER_MONTH: int(2500, { min: 1 }),
    SOURCE_QUOTA_SAFETY: z.preprocess(
      emptyToUndefined,
      z.coerce.number().min(0.1).max(1).default(0.9),
    ),

    // ── Tests ───────────────────────────────────────────────────────────────
    TEST_DATABASE_URL: optStr(),
    AI_LIVE_TESTS: bool(false),
  })
  .transform((env) => ({
    ...env,
    SUPABASE_JWT_ISSUER:
      env.SUPABASE_JWT_ISSUER ??
      (env.SUPABASE_URL ? `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1` : undefined),
  }));

export type Env = z.infer<typeof envSchema>;
export type EnvKey = keyof Env;

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvError';
  }
}

/** Parse and validate an environment map (defaults to `process.env`). Throws `EnvError` with every problem listed. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new EnvError(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}

/** Fail fast with a list of every required key that is missing. */
export function assertEnv<K extends EnvKey>(
  env: Env,
  keys: readonly K[],
): asserts env is Env & { [P in K]-?: NonNullable<Env[P]> } {
  const missing = keys.filter((k) => env[k] === undefined || env[k] === null);
  if (missing.length > 0) {
    throw new EnvError(
      `Missing required environment variables:\n${missing.map((k) => `  - ${String(k)}`).join('\n')}\nSee .env.example for descriptions.`,
    );
  }
}
