import { defineConfig, devices } from '@playwright/test';
import { API_URL, loadTestEnv, WEB_URL } from './test-env';

/**
 * Browser tests (F9) against the LOCAL Supabase stack only (loadTestEnv refuses anything else).
 *
 * Both servers are started here with an explicit environment. The API runs from `e2e/` — a
 * folder with no `.env` — and every provider key is set to empty, so dotenv (which never
 * overrides a set variable) cannot pull a real AI, Telegram or Adzuna key from anywhere. With no
 * AI key every AI step takes its deterministic fallback; with no bot token nothing is sent.
 */
const env = loadTestEnv();

const apiEnv = {
  ...env,
  NODE_ENV: 'test',
  PORT: '4000',
  WEB_ORIGIN: WEB_URL,
  APP_BASE_URL: WEB_URL,
  AI_GEMINI_API_KEY: '',
  AI_CLAUDE_API_KEY: '',
  TELEGRAM_BOT_TOKEN: '',
  TELEGRAM_WEBHOOK_SECRET: '',
  ADZUNA_APP_ID: '',
  ADZUNA_APP_KEY: '',
  WORKER_DISPATCH_TOKEN: '',
  LOG_LEVEL: 'warn',
};
const webEnv = {
  // Inlined at build time; set here so the build never takes apps/web/.env.local's values.
  NEXT_PUBLIC_SUPABASE_URL: env.SUPABASE_URL!,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY!,
  NEXT_PUBLIC_API_BASE_URL: API_URL,
  NEXT_PUBLIC_TELEGRAM_BOT_USERNAME: '',
  NEXT_TELEMETRY_DISABLED: '1',
};

export default defineConfig({
  testDir: './browser',
  // One shared database: run serially, and never retry — a flaky test must show up as one.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node ../apps/api/dist/main.js',
      cwd: __dirname,
      url: `${API_URL}/health`,
      env: apiEnv,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @jobsentinel/web build && pnpm --filter @jobsentinel/web start',
      cwd: __dirname,
      url: WEB_URL,
      env: webEnv,
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
