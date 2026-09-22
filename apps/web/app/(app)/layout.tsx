import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import type { Me } from '@jobsentinel/types';
import { ApiError } from '@/lib/api';
import { serverApi } from '@/lib/api-server';
import { isSupabaseConfigured } from '@/lib/env';
import { AppShell } from '@/components/layout/AppShell';

/**
 * Authenticated app shell. Users who have not finished onboarding are sent to /onboarding.
 * (proxy.ts already guarantees a session; this adds the API-side onboarding state.)
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  if (isSupabaseConfigured()) {
    try {
      const api = await serverApi();
      const { data: me } = await api.get<Me>('/me');
      if (!me.onboardingCompleted) redirect('/onboarding');
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) redirect('/login?error=not_allowed');
      if (!(err instanceof ApiError)) throw err; // redirect() throws; let it propagate
      // API down: render the shell anyway so the user sees an error state instead of a loop.
    }
  }
  return <AppShell>{children}</AppShell>;
}
