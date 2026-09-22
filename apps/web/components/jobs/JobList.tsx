/* eslint-disable */
'use client';

import { useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { JobCard } from './JobCard';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { JobCard as JobCardType } from '@/lib/types/jobs';
import { Button } from '@/components/ui/button';

interface JobListProps {
  jobs: JobCardType[];
  isLoading: boolean;
  isError: boolean;
  error?: Error | null;
  hasNextPage?: boolean;
  fetchNextPage?: () => void;
  isFetchingNextPage?: boolean;
}

export function JobList({
  jobs,
  isLoading,
  isError,
  error,
  hasNextPage,
  fetchNextPage,
  isFetchingNextPage,
}: JobListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: hasNextPage ? jobs.length + 1 : jobs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200,
    overscan: 5,
  });

  useEffect(() => {
    const [lastItem] = virtualizer.getVirtualItems().slice(-1);
    if (lastItem && lastItem.index >= jobs.length - 1 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage?.();
    }
  }, [
    virtualizer.getVirtualItems(),
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    jobs.length,
    virtualizer,
  ]);

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{error?.message || 'Failed to load jobs.'}</AlertDescription>
      </Alert>
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 border border-dashed rounded-lg space-y-3">
        <div className="text-muted-foreground text-center">
          No jobs found matching your criteria.
        </div>
        <Button variant="outline" onClick={() => (window.location.search = '')}>
          Clear Filters
        </Button>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="h-[800px] w-full overflow-y-auto pr-2"
      style={{ contain: 'strict' }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const isLoaderRow = virtualItem.index > jobs.length - 1;
          const job = jobs[virtualItem.index];

          return (
            <div
              key={virtualItem.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
                paddingBottom: '1rem',
              }}
            >
              {isLoaderRow ? (
                <div className="flex justify-center p-4">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <JobCard job={job} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
