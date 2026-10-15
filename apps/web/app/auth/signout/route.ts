import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAuthFailure } from '@/lib/auth-redirect';

/**
 * Ends the Supabase session and returns to /login with a reason.
 *
 * Server layouts cannot clear cookies, so a layout that learns the API refuses this user (403,
 * not on ALLOWED_SIGNUP_EMAILS) redirects here. Sending such a user straight to /login looped
 * forever: the proxy saw a live session on /login and sent it back to /dashboard (D90).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const supabase = await createClient();
  await supabase.auth.signOut();
  const reason = searchParams.get('error');
  const query = reason && isAuthFailure(reason) ? `?error=${reason}` : '';
  return NextResponse.redirect(`${origin}/login${query}`);
}
