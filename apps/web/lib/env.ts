/**
 * Public (browser-safe) configuration. Only NEXT_PUBLIC_* variables may appear here.
 * Server secrets never enter the web app (docs 11).
 */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000',
  telegramBotUsername: process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? '',
} as const;

export const isSupabaseConfigured = (): boolean =>
  publicEnv.supabaseUrl.length > 0 && publicEnv.supabaseAnonKey.length > 0;
