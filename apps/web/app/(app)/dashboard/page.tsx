import type { Metadata } from 'next';
import Link from 'next/link';
import type { Me, PreferredRole, Profile } from '@jobsentinel/types';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { serverApi } from '@/lib/api-server';
import { isSupabaseConfigured } from '@/lib/env';

export const metadata: Metadata = { title: 'Dashboard' };

/** Phase 2 placeholder: shows the confirmed profile. The real dashboard (docs 04 §4) is Gemini's Phase 8. */
export default async function DashboardPage() {
  let me: Me | null = null;
  let profile: Profile | null = null;
  let roles: PreferredRole[] = [];
  let apiError: string | null = null;

  if (isSupabaseConfigured()) {
    try {
      const api = await serverApi();
      [me, profile, roles] = await Promise.all([
        api.get<Me>('/me').then((r) => r.data),
        api
          .get<Profile>('/profile')
          .then((r) => r.data)
          .catch(() => null),
        api.get<PreferredRole[]>('/preferred-roles').then((r) => r.data),
      ]);
    } catch (err) {
      apiError = err instanceof ApiError ? `${err.code}: ${err.message}` : 'API unreachable';
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {me ? `Signed in as ${me.user.email}` : (apiError ?? 'Not signed in')}
          </p>
        </div>
        {me && <SignOutButton />}
      </header>

      {profile && (
        <section className="mt-6 grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Your profile</CardTitle>
              <CardDescription>
                {profile.experienceLevel.replace('_', ' ').toLowerCase()} · {profile.degree ?? '—'}{' '}
                {profile.branch ?? ''} · {profile.graduationYear ?? '—'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {profile.summary && <p className="text-sm">{profile.summary}</p>}
              <ul className="flex flex-wrap gap-1.5" aria-label="Skills">
                {profile.skills.map((s) => (
                  <li key={s.id}>
                    <Badge variant="secondary">{s.name}</Badge>
                  </li>
                ))}
              </ul>
              <Link href="/onboarding" className="text-sm underline underline-offset-4">
                Re-run onboarding
              </Link>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Target roles</CardTitle>
              <CardDescription>Profile version {me?.profileVersion}</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                {roles.map((r) => (
                  <li key={r.id} className="flex items-center justify-between">
                    <span>{r.title}</span>
                    <Badge variant={r.tier === 'PRIMARY' ? 'default' : 'outline'}>
                      {r.tier.toLowerCase()}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}

      <section className="mt-6 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Job monitoring arrives in Phase 4; the full dashboard UI in Phase 8.
      </section>
    </main>
  );
}
