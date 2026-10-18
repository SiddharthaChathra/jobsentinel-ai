'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { SignupCheckResult } from '@jobsentinel/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, createApiClient } from '@/lib/api';
import {
  accountErrorMessage,
  CALLBACK_PATH,
  EXISTING_ACCOUNT,
  PASSWORD_MIN_LENGTH,
  passwordProblem,
} from '@/lib/auth-redirect';
import { createClient } from '@/lib/supabase/client';

type Status = { kind: 'idle' | 'busy' | 'sent' | 'error'; message?: string };

/**
 * Account creation (D91). Open to anyone by default (D93). The API's allow-list is still asked
 * first, so an instance restricted with ALLOWED_SIGNUP_EMAILS refuses an email here — before
 * Supabase creates an account and sends a confirmation email that could only end in a refusal.
 */
export function SignupForm({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!configured) return;
    const problem = passwordProblem(password, confirm);
    if (problem) return setStatus({ kind: 'error', message: problem });
    setStatus({ kind: 'busy' });

    try {
      const api = createApiClient({ getToken: () => Promise.resolve(null) });
      const { data } = await api.post<SignupCheckResult>('/auth/signup-check', { email });
      if (!data.allowed) {
        return setStatus({
          kind: 'error',
          message: 'Sign-up is currently limited, and this email is not on the list of accounts.',
        });
      }
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 429
          ? 'Too many attempts. Wait a minute, then try again.'
          : 'Could not reach JobSentinel. Check your connection and try again.';
      return setStatus({ kind: 'error', message });
    }

    const { data, error } = await createClient().auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}${CALLBACK_PATH}?next=/onboarding` },
    });
    if (error) return setStatus({ kind: 'error', message: accountErrorMessage(error) });
    // With email confirmation on, Supabase answers an existing address with an obfuscated user
    // that has no identities instead of an error, so it cannot be used to probe for accounts.
    if (data.user && data.user.identities?.length === 0) {
      return setStatus({ kind: 'error', message: EXISTING_ACCOUNT });
    }
    if (data.session) {
      router.replace('/onboarding');
      router.refresh();
      return;
    }
    setStatus({
      kind: 'sent',
      message: `We sent a confirmation link to ${email}. Open it in this browser to finish creating your account.`,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>Free. Get verified fresher jobs matched to your resume.</CardDescription>
      </CardHeader>
      <CardContent>
        {status.kind === 'sent' ? (
          <p role="status" className="text-sm">
            {status.message}
          </p>
        ) : (
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
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={PASSWORD_MIN_LENGTH}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                At least {PASSWORD_MIN_LENGTH} characters.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            {status.kind === 'error' && (
              <p role="alert" className="text-sm text-destructive">
                {status.message}
              </p>
            )}
            <Button
              type="submit"
              className="w-full"
              data-testid="signup-submit"
              disabled={!configured || status.kind === 'busy'}
            >
              {status.kind === 'busy' ? 'Creating account…' : 'Create account'}
            </Button>
          </form>
        )}
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="underline underline-offset-4 hover:text-foreground">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
