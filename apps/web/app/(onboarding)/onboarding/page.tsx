import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { Me } from '@jobsentinel/types';
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard';
import { ApiError } from '@/lib/api';
import { serverApi } from '@/lib/api-server';
import { isSupabaseConfigured } from '@/lib/env';

export const metadata: Metadata = { title: 'Set up your profile' };

export default async function OnboardingPage() {
  if (isSupabaseConfigured()) {
    try {
      const api = await serverApi();
      const { data: me } = await api.get<Me>('/me');
      if (me.onboardingCompleted) redirect('/dashboard');
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      if (err.status === 403) redirect('/login?error=not_allowed');
    }
  }
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Set up JobSentinel</h1>
        <p className="text-sm text-muted-foreground">
          Upload your resume, confirm what we found, and choose what to monitor. Nothing is decided
          for you silently.
        </p>
      </header>
      <OnboardingWizard />
    </main>
  );
}
