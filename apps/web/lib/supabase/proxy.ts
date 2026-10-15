import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { strayAuthRedirect } from '@/lib/auth-redirect';
import { isSupabaseConfigured, publicEnv } from '@/lib/env';

const PUBLIC_PATHS = ['/login', '/signup', '/auth'];

/**
 * Refreshes the Supabase session cookie on every request and performs the optimistic
 * auth redirect (unauthenticated → /login, authenticated on /login → /dashboard).
 * Real authorization happens in the API; this only shapes navigation.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  // A sign-in link that landed on the Site URL instead of the callback (its redirect was not on
  // Supabase's allow-list) would otherwise be redirected to /login with its code thrown away (D87).
  const stray = strayAuthRedirect(request.nextUrl);
  if (stray) return NextResponse.redirect(stray);

  let response = NextResponse.next({ request });
  if (!isSupabaseConfigured()) return response; // Phase 1 / local dev without Supabase

  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Do not run code between createServerClient and getUser() — see @supabase/ssr docs.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  // Not while an error is shown: a page that rejects this session sends it to /login, and
  // bouncing it back to /dashboard from here made an endless redirect loop (D90).
  const showingError = request.nextUrl.searchParams.has('error');
  if (user && !showingError && (pathname === '/login' || pathname === '/signup')) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return response;
}
