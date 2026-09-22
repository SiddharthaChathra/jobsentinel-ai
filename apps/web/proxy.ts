import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

// Next.js 16: `proxy.ts` replaces `middleware.ts`.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Everything except static assets and images.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
