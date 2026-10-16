import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { isSupabaseConfigured } from '@/lib/env';
import { Logo } from '@/components/brand/Logo';

export const metadata: Metadata = { title: 'Forgot password' };

export default function Page() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <Logo size={64} className="mx-auto mb-3 drop-shadow-md" />
          <h1 className="text-2xl font-semibold tracking-tight">JobSentinel AI</h1>
          <p className="text-sm text-muted-foreground">Get back into your account</p>
        </div>
        {/* useSearchParams() inside the form requires a Suspense boundary for static rendering */}
        <Suspense fallback={null}>
          <ForgotPasswordForm configured={isSupabaseConfigured()} />
        </Suspense>
      </div>
    </main>
  );
}
