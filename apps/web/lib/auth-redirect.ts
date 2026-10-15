/**
 * Pure helpers for the magic-link round trip (login form → Supabase → /auth/callback).
 *
 * Supabase sends a sign-in link to `emailRedirectTo` only if that URL is on the project's
 * Redirect URLs allow-list; otherwise it silently falls back to the project's Site URL. The deployed
 * site broke exactly that way: the Site URL named a domain that does not exist, and the callback
 * never ran (D87). These helpers keep the flow working when the link lands on the Site URL root,
 * and turn every failure into a reason the login page can explain instead of a silent bounce.
 */

export const CALLBACK_PATH = '/auth/callback';

export type AuthFailure =
  'link_expired' | 'different_browser' | 'link_invalid' | 'not_allowed' | 'unknown';

/** Same-origin relative paths only: `next` comes from a URL anyone can craft. */
export function safeNextPath(next: string | null | undefined, fallback = '/dashboard'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return fallback;
  }
  return next;
}

// Supabase PKCE auth codes are UUIDs; matching the shape keeps an unrelated `?code=` alone.
const AUTH_CODE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * When a Supabase redirect lands somewhere other than the callback — the Site URL root, typically —
 * returns the callback URL that should handle it, carrying the auth parameters across. Returns
 * null for every ordinary request.
 */
export function strayAuthRedirect(url: URL): URL | null {
  if (url.pathname === CALLBACK_PATH) return null;
  const params = url.searchParams;
  const code = params.get('code');
  const hasCode = code !== null && AUTH_CODE.test(code);
  const hasTokenHash = params.has('token_hash') && params.has('type');
  const hasError =
    params.has('error') && (params.has('error_code') || params.has('error_description'));
  if (!hasCode && !hasTokenHash && !hasError) return null;

  const target = new URL(CALLBACK_PATH, url.origin);
  for (const key of ['code', 'token_hash', 'type', 'error', 'error_code', 'error_description']) {
    const value = params.get(key);
    if (value !== null) target.searchParams.set(key, value);
  }
  const next = params.get('next') ?? (url.pathname === '/' ? null : url.pathname);
  target.searchParams.set('next', safeNextPath(next));
  return target;
}

/** Maps a Supabase auth error (redirect params or a thrown AuthError) to something explainable. */
export function classifyAuthFailure(error: {
  code?: string | null;
  message?: string | null;
}): AuthFailure {
  const code = (error.code ?? '').toLowerCase();
  const message = (error.message ?? '').toLowerCase();
  // The PKCE verifier lives in a cookie of the browser that asked for the link; opening the email
  // in another browser or an in-app mail viewer cannot complete the exchange.
  if (code.includes('code_verifier') || message.includes('code verifier')) {
    return 'different_browser';
  }
  if (code === 'otp_expired' || code === 'flow_state_expired' || message.includes('expired')) {
    return 'link_expired';
  }
  if (code === 'flow_state_not_found' || code.startsWith('otp_') || message.includes('invalid')) {
    return 'link_invalid';
  }
  return 'unknown';
}

const MESSAGES: Record<AuthFailure, string> = {
  link_expired: 'That sign-in link has expired or was already used. Request a new one below.',
  different_browser:
    'Open the sign-in link in the same browser you requested it from, or request a new link here.',
  link_invalid: 'That sign-in link is not valid any more. Request a new one below.',
  not_allowed:
    'This email is not allowed to use this JobSentinel. Sign in with the account it was set up for.',
  unknown: 'Sign-in could not be completed. Request a new link, or use your password.',
};

export function isAuthFailure(value: string): value is AuthFailure {
  return value in MESSAGES;
}

/** Message for the login page's `?error=` parameter; null when there is nothing to show. */
export function authErrorMessage(reason: string | null): string | null {
  if (!reason) return null;
  if (isAuthFailure(reason)) return MESSAGES[reason];
  // Older callback builds used a single generic code.
  return MESSAGES.unknown;
}

/**
 * Message for an error returned while *requesting* a link. With `shouldCreateUser: false`,
 * Supabase answers an unknown email with "Signups not allowed for otp", which reads as a fault.
 */
export function requestLinkErrorMessage(error: { code?: string | null; message: string }): string {
  if (error.code === 'otp_disabled' || /signups not allowed/i.test(error.message)) {
    return 'No JobSentinel account uses this email. Check the address, or sign in with your password.';
  }
  if (error.code === 'over_email_send_rate_limit' || /rate limit/i.test(error.message)) {
    return 'Too many sign-in emails were sent. Wait a few minutes, then try again.';
  }
  return error.message;
}
