'use client';

import Link from 'next/link';
import { BookmarkX } from 'lucide-react';
import { JobList } from '@/components/jobs/JobList';
import { PageHeader } from '@/components/layout/PageHeader';
import { buttonVariants } from '@/components/ui/button';
import { useSavedJobs } from '@/hooks/useJobs';

import { JobCard } from '@/components/jobs/JobCard';
import { ApplicationDatePickers } from '@/components/reminders/ApplicationDatePickers';

export default function SavedJobsPage() {
  const { data, isLoading, isError, error } = useSavedJobs();
  const jobs = data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Saved jobs"
        description={
          jobs.length > 0
            ? `${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'} you are keeping an eye on.`
            : 'Jobs you bookmark are kept here, even after they expire.'
        }
      />
      <JobList
        jobs={jobs}
        isLoading={isLoading}
        isError={isError}
        error={error as Error}
        hasNextPage={Boolean(data?.meta?.nextCursor)}
        renderItem={(job) => (
          <div className="space-y-2">
            <JobCard job={job} />
            <div className="rounded-lg border border-border/60 bg-card/60 p-2.5">
              <ApplicationDatePickers jobId={job.id} deadline={job.deadline} deadlineOnly />
            </div>
          </div>
        )}
        empty={
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
            <BookmarkX className="size-8 text-muted-foreground" />
            <div>
              <p className="font-medium">Nothing saved yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Tap Save on any job and it will wait for you here — saved jobs are never deleted,
                even once the posting closes.
              </p>
            </div>
            <Link href="/jobs" className={buttonVariants({ size: 'sm' })}>
              Browse jobs
            </Link>
          </div>
        }
      />
    </>
  );
}
