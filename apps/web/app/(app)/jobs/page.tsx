'use client';

import { useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { JobFilters } from '@/components/jobs/JobFilters';
import { JobList } from '@/components/jobs/JobList';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { useFilterParams } from '@/hooks/useFilterParams';
import { useJobs } from '@/hooks/useJobs';

export default function JobsPage() {
  const { query } = useFilterParams();
  const { data, isLoading, isError, error } = useJobs(query);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const jobs = data?.data ?? [];
  const hasMore = Boolean(data?.meta?.nextCursor);

  return (
    <>
      <PageHeader
        title="Jobs"
        description={
          isLoading
            ? 'Loading…'
            : // The API pages by cursor and returns no total, so report what is actually loaded
              // rather than implying a count we do not have.
              `${jobs.length}${hasMore ? '+' : ''} ${jobs.length === 1 ? 'job' : 'jobs'} matching your filters`
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            className="md:hidden"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            aria-controls="job-filters-mobile"
          >
            {filtersOpen ? (
              <X className="mr-1.5 size-4" />
            ) : (
              <SlidersHorizontal className="mr-1.5 size-4" />
            )}
            Filters
          </Button>
        }
      />

      <div className="grid items-start gap-6 md:grid-cols-12">
        <aside className="sticky top-20 hidden md:col-span-4 md:block lg:col-span-3">
          <JobFilters />
        </aside>

        <section className="min-w-0 md:col-span-8 lg:col-span-9">
          {/* On a phone the filters stay collapsed: otherwise they fill the first screen and the
              jobs — the reason for the page — are pushed below the fold. */}
          {filtersOpen && (
            <div id="job-filters-mobile" className="mb-4 md:hidden">
              <JobFilters />
            </div>
          )}

          <JobList
            jobs={jobs}
            isLoading={isLoading}
            isError={isError}
            error={error as Error}
            hasNextPage={hasMore}
          />
        </section>
      </div>
    </>
  );
}
