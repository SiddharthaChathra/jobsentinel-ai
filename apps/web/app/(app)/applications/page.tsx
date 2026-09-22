'use client';

import { useApplications } from '@/hooks/useJobs';
import { JobCard } from '@/components/jobs/JobCard';
import { Loader2 } from 'lucide-react';
import type { ApplicationStatus } from '@jobsentinel/types';

const STATUS_COLUMNS: { id: ApplicationStatus; label: string }[] = [
  { id: 'VIEWED', label: 'Viewed' },
  { id: 'APPLIED', label: 'Applied' },
  { id: 'INTERVIEW', label: 'Interview' },
  { id: 'SELECTED', label: 'Selected' },
  { id: 'REJECTED', label: 'Rejected' },
];

export default function ApplicationsPage() {
  const { data, isLoading } = useApplications();

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const items = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Applications</h1>
        <p className="text-muted-foreground">Track your job search progress</p>
      </div>

      <div className="flex gap-4 min-w-[1000px] h-[calc(100vh-200px)]">
        {STATUS_COLUMNS.map((col) => {
          const columnItems = items.filter((a) => a.status === col.id);

          return (
            <div
              key={col.id}
              className="flex-1 bg-muted/50 rounded-lg flex flex-col overflow-hidden"
            >
              <div className="p-4 font-semibold text-sm border-b bg-muted flex items-center justify-between">
                {col.label}
                <span className="bg-background rounded-full px-2 py-0.5 text-xs">
                  {columnItems.length}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {columnItems.map((app) => (
                  <JobCard key={app.job.id} job={app.job} />
                ))}
                {columnItems.length === 0 && (
                  <div className="text-center text-muted-foreground text-sm pt-8">No jobs</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
