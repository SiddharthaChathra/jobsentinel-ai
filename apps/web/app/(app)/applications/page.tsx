'use client';

import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import type { ApplicationStatus } from '@jobsentinel/types';
import { JobCard } from '@/components/jobs/JobCard';
import { PageHeader } from '@/components/layout/PageHeader';
import { buttonVariants } from '@/components/ui/button';
import { useApplications } from '@/hooks/useJobs';

const STATUS_COLUMNS: { id: ApplicationStatus; label: string; hint: string }[] = [
  { id: 'VIEWED', label: 'Viewed', hint: 'Opened, not applied yet' },
  { id: 'APPLIED', label: 'Applied', hint: 'Application sent' },
  { id: 'INTERVIEW', label: 'Interview', hint: 'In process' },
  { id: 'SELECTED', label: 'Selected', hint: 'Offer received' },
  { id: 'REJECTED', label: 'Rejected', hint: 'Closed' },
];

/**
 * Kanban on a wide screen, grouped list on a phone (docs 04 §2). Five columns cannot be made
 * readable at 360 px, and a horizontally scrolling board is worse than a vertical list.
 */
export default function ApplicationsPage() {
  const { data, isLoading } = useApplications();
  const items = data?.data ?? [];

  const byStatus = STATUS_COLUMNS.map((col) => ({
    ...col,
    items: items.filter((a) => a.status === col.id),
  }));
  const total = items.length;

  return (
    <>
      <PageHeader
        title="Applications"
        description={
          total > 0
            ? `${total} ${total === 1 ? 'job' : 'jobs'} in your tracker.`
            : 'Track every job you open, apply to and hear back from.'
        }
      />

      {isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {STATUS_COLUMNS.map((c) => (
            <div
              key={c.id}
              className="h-40 animate-pulse rounded-xl border border-border/60 bg-muted/40"
            />
          ))}
        </div>
      )}

      {!isLoading && total === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <ClipboardList className="size-8 text-muted-foreground" />
          <div>
            <p className="font-medium">No applications tracked yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Opening a job records it as Viewed, and you can move it through Applied, Interview and
              beyond from the job page.
            </p>
          </div>
          <Link href="/jobs" className={buttonVariants({ size: 'sm' })}>
            Find jobs to apply to
          </Link>
        </div>
      )}

      {!isLoading && total > 0 && (
        <div className="grid gap-4 lg:grid-cols-5">
          {byStatus.map((col) => (
            <section key={col.id} className="min-w-0">
              <header className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">{col.label}</h3>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                  {col.items.length}
                </span>
              </header>
              <div className="space-y-3 rounded-xl bg-muted/40 p-2 lg:min-h-32">
                {col.items.map((app) => (
                  <JobCard key={app.job.id} job={app.job} />
                ))}
                {col.items.length === 0 && (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">{col.hint}</p>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
