'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { AlertCircle, Loader2, SearchX } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { JobCard as JobCardType } from '@/lib/types/jobs';
import { JobCard } from './JobCard';

interface JobListProps {
  jobs: JobCardType[];
  isLoading: boolean;
  isError: boolean;
  error?: Error | null;
  hasNextPage?: boolean;
  fetchNextPage?: () => void;
  isFetchingNextPage?: boolean;
  /** Each page supplies its own empty state — "no results" and "nothing saved" are different. */
  empty?: ReactNode;
  /** Optional custom card renderer (e.g. to wrap with date pickers on saved jobs). */
  renderItem?: (job: JobCardType) => ReactNode;
}

/** Roughly one card; the virtualizer measures the real height as rows render. */
const ESTIMATED_CARD_PX = 232;

/**
 * Virtualised job list. It virtualises against the **window**, so the page scrolls normally
 * instead of trapping a second scrollbar inside a fixed-height box — that nested scroller was
 * awkward on a phone and made the footer unreachable.
 */
export function JobList({
  jobs,
  isLoading,
  isError,
  error,
  hasNextPage,
  fetchNextPage,
  isFetchingNextPage,
  empty,
  renderItem,
}: JobListProps) {
  // A callback ref, not `useRef`: the virtualizer needs the list's offset from the top of the
  // page, and reading `ref.current` during render is not allowed. This measures once on mount.
  const [scrollMargin, setScrollMargin] = useState(0);
  const listRef = useCallback((node: HTMLDivElement | null) => {
    if (node) setScrollMargin(node.offsetTop);
  }, []);

  const virtualizer = useWindowVirtualizer({
    count: hasNextPage ? jobs.length + 1 : jobs.length,
    estimateSize: () => ESTIMATED_CARD_PX,
    overscan: 4,
    scrollMargin,
  });

  const items = virtualizer.getVirtualItems();
  const lastIndex = items.at(-1)?.index;

  useEffect(() => {
    if (lastIndex === undefined || !hasNextPage || isFetchingNextPage) return;
    if (lastIndex >= jobs.length - 1) fetchNextPage?.();
  }, [lastIndex, hasNextPage, isFetchingNextPage, fetchNextPage, jobs.length]);

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="size-4" />
        <AlertTitle>Could not load jobs</AlertTitle>
        <AlertDescription>{error?.message ?? 'Please try again.'}</AlertDescription>
      </Alert>
    );
  }

  if (isLoading) {
    return (
      // Distinct keys on this wrapper and the list's: both are a <div> at the same position, and the
      // skeletons' keys 0-3 match the first rows', so React would otherwise reuse the measured row
      // nodes as skeletons — stripping `data-index` while the virtualizer's ResizeObserver still
      // watches them ("Missing attribute name 'data-index'" on every filter change).
      <div key="loading" className="space-y-3" aria-busy="true" aria-label="Loading jobs">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-40 animate-pulse rounded-xl border border-border/60 bg-muted/40"
          />
        ))}
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      empty ?? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <SearchX className="size-8 text-muted-foreground" />
          <div>
            <p className="font-medium">No jobs match these filters</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try widening the location, lowering the minimum score, or clearing the search.
            </p>
          </div>
        </div>
      )
    );
  }

  return (
    <div
      key="rows"
      ref={listRef}
      className="relative"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {items.map((virtualItem) => {
        const isLoaderRow = virtualItem.index > jobs.length - 1;
        const job = jobs[virtualItem.index];
        return (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            className="absolute inset-x-0 top-0 pb-3"
            style={{
              transform: `translateY(${virtualItem.start - virtualizer.options.scrollMargin}px)`,
            }}
          >
            {isLoaderRow ? (
              <div className="flex justify-center p-4">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              job && (renderItem ? renderItem(job) : <JobCard job={job} />)
            )}
          </div>
        );
      })}
    </div>
  );
}
