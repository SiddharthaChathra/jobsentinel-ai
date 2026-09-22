'use client';

import { JobFilters } from '@/components/jobs/JobFilters';
import { JobList } from '@/components/jobs/JobList';
import { useJobs } from '@/hooks/useJobs';
import { useFilterParams } from '@/hooks/useFilterParams';

export default function JobsPage() {
  const { query } = useFilterParams();

  // Note: we are using a simple query for now. TanStack infinite query would be better here for real infinite scroll,
  // but `useJobs` currently just wraps a standard query. We will mock the pagination interaction.
  const { data, isLoading, isError, error } = useJobs(query);

  const jobs = data?.data || [];
  const meta = data?.meta;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Job Matches</h1>
          <p className="text-muted-foreground">
            {meta?.total ? `Found ${meta.total} matches` : 'Finding your best matches...'}
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-12 flex-1 items-start">
        <aside className="hidden md:block md:col-span-3 sticky top-6">
          <JobFilters />
        </aside>

        <section className="md:col-span-9 w-full">
          <div className="md:hidden mb-4">
            {/* We'd use a Sheet component here for mobile filters, omitted for brevity */}
            <JobFilters />
          </div>

          <JobList
            jobs={jobs}
            isLoading={isLoading}
            isError={isError}
            error={error as Error}
            hasNextPage={!!meta?.nextCursor}
            isFetchingNextPage={false} // Would come from useInfiniteQuery
          />
        </section>
      </div>
    </div>
  );
}
