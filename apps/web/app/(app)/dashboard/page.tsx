import type { Metadata } from 'next';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { isSupabaseConfigured } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Dashboard' };

/** Phase 1 placeholder. The real dashboard (docs 04 §4) is built by Gemini in Phase 8. */
export default async function DashboardPage() {
  let email: string | null = null;
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    email = data.user?.email ?? null;
  }

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {email ? `Signed in as ${email}` : 'Not signed in (Supabase not configured)'}
          </p>
        </div>
        {email && <SignOutButton />}
      </header>
      <section className="mt-8 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Project scaffold is running. Job monitoring arrives in Phase 4; the dashboard UI in Phase 8.
      </section>
    </main>
  );
}
