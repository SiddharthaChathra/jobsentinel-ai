import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { classifyAuthFailure, safeNextPath, type AuthFailure } from '@/lib/auth-redirect';

const OTP_TYPES: readonly EmailOtpType[] = [
  'magiclink',
  'email',
  'signup',
  'invite',
  'recovery',
  'email_change',
];

/**
 * Completes a magic link (or OAuth) sign-in and sets the session cookie.
 *
 * Handles every shape Supabase can send here: a PKCE `code` (the default link), a `token_hash`
 * (an email template pointing at the site directly), and an `error` when Supabase itself refused
 * the link. A failure goes back to /login with a reason the page can explain (D87).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const next = safeNextPath(searchParams.get('next'));
  const fail = (reason: AuthFailure) =>
    NextResponse.redirect(`${origin}/login?error=${reason}&next=${encodeURIComponent(next)}`);

  const supabaseError = searchParams.get('error');
  if (supabaseError) {
    return fail(
      classifyAuthFailure({
        code: searchParams.get('error_code') ?? supabaseError,
        message: searchParams.get('error_description'),
      }),
    );
  }

  const supabase = await createClient();
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return fail(classifyAuthFailure(error));
  }
  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return fail(classifyAuthFailure(error));
  }
  return fail('link_invalid');
}
