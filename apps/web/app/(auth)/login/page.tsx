import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/login-form';
import { isSupabaseConfigured } from '@/lib/env';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">JobSentinel AI</h1>
          <p className="text-sm text-muted-foreground">Sign in to your personal job monitor</p>
        </div>
        {/* useSearchParams() inside the form requires a Suspense boundary for static rendering */}
        <Suspense fallback={null}>
          <LoginForm configured={isSupabaseConfigured()} />
        </Suspense>
      </div>
    </main>
  );
}
