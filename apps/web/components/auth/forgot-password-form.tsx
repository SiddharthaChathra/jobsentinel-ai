'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authErrorMessage, CALLBACK_PATH, requestLinkErrorMessage } from '@/lib/auth-redirect';
import { createClient } from '@/lib/supabase/client';

type Status = { kind: 'idle' | 'busy' | 'sent' | 'error'; message?: string };

/**
 * Requests a password-reset email. The confirmation reads the same whether or not an account
 * exists, so this page cannot be used to find out which emails have accounts.
 */
export function ForgotPasswordForm({ configured }: { configured: boolean }) {
  const params = useSearchParams();
  // An expired or reused reset link comes back here (callbackFailurePath) with its reason.
  const linkError = authErrorMessage(params.get('error'));
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>(
    linkError ? { kind: 'error', message: linkError } : { kind: 'idle' },
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!configured) return;
    setStatus({ kind: 'busy' });
    const { error } = await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}${CALLBACK_PATH}?next=/reset-password`,
    });
    if (error) return setStatus({ kind: 'error', message: requestLinkErrorMessage(error) });
    setStatus({
      kind: 'sent',
      message: `If an account uses ${email}, a password-reset link is on its way. Open it in this browser.`,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>We will email you a link to choose a new password.</CardDescription>
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
            {status.kind === 'error' && (
              <p role="alert" className="text-sm text-destructive">
                {status.message}
              </p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={!configured || status.kind === 'busy'}
            >
              {status.kind === 'busy' ? 'Sending…' : 'Send reset link'}
            </Button>
          </form>
        )}
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Remembered it?{' '}
          <Link href="/login" className="underline underline-offset-4 hover:text-foreground">
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
