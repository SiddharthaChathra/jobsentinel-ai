'use client';

import { useState } from 'react';
import { AlertCircle, AlertTriangle, ArrowRight, Loader2, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useNeedsReview } from '@/hooks/useJobs';
import type { JobsQuery, ReviewJobCard } from '@/lib/types/jobs';
import { JobCard } from './JobCard';

export interface NeedsReviewListProps {
  query: JobsQuery;
}

export function NeedsReviewList({ query }: NeedsReviewListProps) {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [accumulatedJobs, setAccumulatedJobs] = useState<ReviewJobCard[]>([]);

  // Track the base filters to reset pagination when filters change
  const [lastFilterJson, setLastFilterJson] = useState(() => JSON.stringify(query));
  const currentFilterJson = JSON.stringify(query);

  if (currentFilterJson !== lastFilterJson) {
    setLastFilterJson(currentFilterJson);
    setCursor(undefined);
    setAccumulatedJobs([]);
  }

  const queryWithCursor: JobsQuery = {
    ...query,
    cursor,
  };

  const { data, isLoading, isError, error, refetch, isFetching } = useNeedsReview(queryWithCursor);

  // Accumulate jobs across pages
  const currentBatch = data?.data ?? [];
  const nextCursor = data?.meta?.nextCursor;

  // When new batch arrives
  const displayedJobs = cursor
    ? [
        ...accumulatedJobs,
        ...currentBatch.filter((j) => !accumulatedJobs.some((a) => a.id === j.id)),
      ]
    : currentBatch;

  const handleLoadMore = () => {
    if (!nextCursor) return;
    setAccumulatedJobs(displayedJobs);
    setCursor(nextCursor);
  };

  return (
    <div className="space-y-4">
      {/* Header note verbatim per C step 2, D106 */}
      <div
        role="note"
        aria-label="Needs review notice"
        className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50/70 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
      >
        <AlertTriangle className="size-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
        <p className="leading-relaxed">
          {
            "These jobs passed the India, fresher and 60-day checks but couldn't be fully verified. They're never sent to Telegram. Check each one before applying."
          }
        </p>
      </div>

      {/* Error state */}
      {isError && (
        <Alert variant="destructive" data-testid="needs-review-error">
          <AlertCircle className="size-4" />
          <AlertTitle>Could not load review jobs</AlertTitle>
          <AlertDescription className="mt-2 flex flex-col gap-3">
            <span>{error instanceof Error ? error.message : 'Please try again.'}</span>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="w-fit">
              <RefreshCw className="mr-1.5 size-3.5" />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Loading state */}
      {isLoading && displayedJobs.length === 0 && (
        <div className="space-y-3" aria-busy="true" aria-label="Loading review jobs">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-44 animate-pulse rounded-xl border border-border/60 bg-muted/40"
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && displayedJobs.length === 0 && (
        <div
          data-testid="needs-review-empty"
          className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center"
        >
          <AlertTriangle className="size-8 text-muted-foreground" />
          <div>
            <p className="font-medium">Nothing needs review right now</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Held jobs that require manual inspection before applying will appear here.
            </p>
          </div>
        </div>
      )}

      {/* Needs review list */}
      {displayedJobs.length > 0 && (
        <div data-testid="needs-review-list" className="space-y-3">
          {displayedJobs.map((job) => (
            <JobCard key={job.id} job={job} held={job.held} />
          ))}

          {/* Pagination */}
          {nextCursor && (
            <div className="pt-2 flex justify-center">
              <Button variant="outline" size="sm" onClick={handleLoadMore} disabled={isFetching}>
                {isFetching ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <ArrowRight className="mr-1.5 size-4" />
                )}
                Load more
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
