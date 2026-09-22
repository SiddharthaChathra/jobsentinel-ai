import type { Metadata } from 'next';
import { serverApi } from '@/lib/api-server';
import { isSupabaseConfigured } from '@/lib/env';
import { StatTiles } from '@/components/dashboard/StatTiles';
import { PrioritySummary } from '@/components/dashboard/PrioritySummary';
import { RecentJobs } from '@/components/dashboard/RecentJobs';
import { TopMatches } from '@/components/dashboard/TopMatches';
import { SystemMini } from '@/components/dashboard/SystemMini';
import type { DashboardSummary } from '@/lib/types/jobs';
import type { Me } from '@jobsentinel/types';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  let me: Me | null = null;
  let summary: DashboardSummary | null = null;
  let apiError: string | null = null;

  if (isSupabaseConfigured()) {
    try {
      const api = await serverApi();
      [me, summary] = await Promise.all([
        api.get<Me>('/me').then((r) => r.data),
        api.get<DashboardSummary>('/dashboard/summary').then((r) => r.data),
      ]);
    } catch (err: unknown) {
      apiError = err instanceof Error ? err.message : 'API unreachable';
    }
  }

  if (apiError || !summary) {
    return (
      <div className="space-y-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            {apiError ?? 'Failed to load dashboard data. Please try again later.'}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            {me ? `Welcome back, ${me.user.displayName ?? me.user.email}` : 'Welcome back'}
          </p>
        </div>
      </header>

      <StatTiles summary={summary} />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <div className="lg:col-span-4 space-y-4">
          <TopMatches summary={summary} />
          <RecentJobs summary={summary} />
        </div>
        <div className="lg:col-span-3 space-y-4">
          <SystemMini summary={summary} />
          <PrioritySummary summary={summary} />
        </div>
      </div>
    </div>
  );
}
