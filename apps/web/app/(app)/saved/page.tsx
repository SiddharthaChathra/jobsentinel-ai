'use client';

import { JobList } from '@/components/jobs/JobList';
import { useSavedJobs } from '@/hooks/useJobs';

export default function SavedJobsPage() {
  const { data, isLoading, isError, error } = useSavedJobs();

  const jobs = data?.data ?? [];
  const meta = data?.meta;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Saved Jobs</h1>
          <p className="text-muted-foreground">Your saved opportunities</p>
        </div>
      </div>

      <div className="mt-4">
        <JobList
          jobs={jobs}
          isLoading={isLoading}
          isError={isError}
          error={error as Error}
          hasNextPage={!!meta?.nextCursor}
          isFetchingNextPage={false}
        />
      </div>
    </div>
  );
}
