'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  authErrorMessage,
  CALLBACK_PATH,
  requestLinkErrorMessage,
  safeNextPath,
  signInErrorMessage,
} from '@/lib/auth-redirect';
import { createClient } from '@/lib/supabase/client';

type Mode = 'password' | 'magic';
type Status = { kind: 'idle' | 'busy' | 'sent' | 'error'; message?: string };

/**
 * Email + password and magic-link sign-in via Supabase Auth.
 * Sign-up is gated server-side (ALLOWED_SIGNUP_EMAILS); this form only signs in.
 * Phase 1 scaffold — Gemini owns visual polish in Phases 8/11.
 */
export function LoginForm({ configured }: { configured: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const nextPath = safeNextPath(params.get('next'));
  // Arriving from a failed link, the useful next step is another link.
  const [mode, setMode] = useState<Mode>(params.get('error') ? 'magic' : 'password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // A failed magic link comes back as `?error=<reason>`; say why instead of silently resetting.
  const callbackError = authErrorMessage(params.get('error'));
  const [status, setStatus] = useState<Status>(
    callbackError ? { kind: 'error', message: callbackError } : { kind: 'idle' },
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!configured) return;
    setStatus({ kind: 'busy' });
    const supabase = createClient();

    if (mode === 'password') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return setStatus({ kind: 'error', message: signInErrorMessage(error) });
      router.replace(nextPath);
      router.refresh();
      return;
    }

    const redirectTo = `${window.location.origin}${CALLBACK_PATH}?next=${encodeURIComponent(nextPath)}`;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      // Sign-in only: without this, any email typed here created a Supabase account, which the
      // API then refused (ALLOWED_SIGNUP_EMAILS) — accounts for strangers, and a confusing dead end.
      options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
    });
    if (error) return setStatus({ kind: 'error', message: requestLinkErrorMessage(error) });
    setStatus({ kind: 'sent', message: 'Check your inbox for a sign-in link.' });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          {mode === 'password'
            ? 'Use your email and password.'
            : 'We will email you a one-time sign-in link.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!configured && (
          <p
            role="alert"
            className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
          >
            Supabase is not configured. Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to enable sign-in.
          </p>
        )}
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {mode === 'password' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  href="/forgot-password"
                  className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}
          {status.message && (
            <p
              role={status.kind === 'error' ? 'alert' : 'status'}
              className={
                status.kind === 'error'
                  ? 'text-sm text-destructive'
                  : 'text-sm text-muted-foreground'
              }
            >
              {status.message}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={!configured || status.kind === 'busy'}>
            {status.kind === 'busy'
              ? 'Signing in…'
              : mode === 'password'
                ? 'Sign in'
                : 'Send magic link'}
          </Button>
        </form>
        <button
          type="button"
          className="mt-4 w-full text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => {
            setMode(mode === 'password' ? 'magic' : 'password');
            setStatus({ kind: 'idle' });
          }}
        >
          {mode === 'password' ? 'Email me a magic link instead' : 'Use password instead'}
        </button>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          New here?{' '}
          <Link href="/signup" className="underline underline-offset-4 hover:text-foreground">
            Create an account
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
