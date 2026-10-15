'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { accountErrorMessage, PASSWORD_MIN_LENGTH, passwordProblem } from '@/lib/auth-redirect';
import { createClient } from '@/lib/supabase/client';

type Session = 'checking' | 'ready' | 'missing';
type Status = { kind: 'idle' | 'busy' | 'error'; message?: string };

/**
 * Sets a new password. The reset email's link passes through /auth/callback, which signs the user
 * in for exactly this; without that session there is nothing to update, so the page says the
 * link has expired instead of showing a form that cannot work.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const [session, setSession] = useState<Session>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    let active = true;
    void createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (active) setSession(data.user ? 'ready' : 'missing');
      });
    return () => {
      active = false;
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(password, confirm);
    if (problem) return setStatus({ kind: 'error', message: problem });
    setStatus({ kind: 'busy' });
    const { error } = await createClient().auth.updateUser({ password });
    if (error) return setStatus({ kind: 'error', message: accountErrorMessage(error) });
    router.replace('/dashboard');
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a new password</CardTitle>
        <CardDescription>You will stay signed in afterwards.</CardDescription>
      </CardHeader>
      <CardContent>
        {session === 'checking' && <p className="text-sm text-muted-foreground">Checking link…</p>}
        {session === 'missing' && (
          <div className="space-y-4">
            <p role="alert" className="text-sm text-destructive">
              This reset link has expired or was already used.
            </p>
            <Link
              href="/forgot-password"
              className="block text-center text-sm underline underline-offset-4"
            >
              Send a new reset link
            </Link>
          </div>
        )}
        {session === 'ready' && (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
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
              <Label htmlFor="confirm">Confirm new password</Label>
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
            <Button type="submit" className="w-full" disabled={status.kind === 'busy'}>
              {status.kind === 'busy' ? 'Saving…' : 'Save new password'}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
