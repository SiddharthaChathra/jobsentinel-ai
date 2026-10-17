'use client';

import { Button, buttonVariants } from '@/components/ui/button';
import { Bookmark, BookmarkCheck, ExternalLink } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { JobDetail } from '@/lib/types/jobs';
import { useRemoveApplication, useSaveJob, useTracker, useViewJob } from '@/hooks/useJobs';
import type { ApplicationStatus } from '@jobsentinel/types';
import { useRouter } from 'next/navigation';
import { useEffect, useOptimistic, startTransition, useState } from 'react';

// Feeds both the options and Base UI's `items`, so the closed trigger shows "Not Tracking" rather
// than the raw value `UNTRACKED`. NOT_INTERESTED is set elsewhere but must still have a label.
const STATUS_ITEMS = [
  { value: 'UNTRACKED', label: 'Not Tracking' },
  { value: 'VIEWED', label: 'Viewed' },
  { value: 'APPLIED', label: 'Applied' },
  { value: 'INTERVIEW', label: 'Interview' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'SELECTED', label: 'Selected' },
];
const STATUS_LABELS: Record<string, string> = {
  ...Object.fromEntries(STATUS_ITEMS.map((i) => [i.value, i.label])),
  NOT_INTERESTED: 'Not interested',
};

export function TrackerActions({ job }: { job: JobDetail }) {
  const saveMutation = useSaveJob();
  const trackerMutation = useTracker();
  const removeMutation = useRemoveApplication();
  const viewMutation = useViewJob();

  // `job` is fetched by the server component that renders this one, so it lives outside React
  // Query's cache: invalidating query keys cannot update it. Only a router refresh re-runs the
  // server render, and without it a saved change looks like it silently failed (D70).
  const router = useRouter();
  const refresh = { onSuccess: () => router.refresh() };

  // The refresh above is a server round-trip, so the control would sit on its old value until it
  // lands. `useOptimistic` covers that gap and reverts by itself if the transition fails.
  const [optimisticStatus, setOptimisticStatus] = useOptimistic(
    job.tracker.status || 'UNTRACKED',
    (_state, newStatus: string) => newStatus,
  );

  // Record a view when the component mounts (the user opened the detail page).
  useEffect(() => {
    // The server records VIEWED, so refresh like every other tracker change; otherwise the status
    // control keeps saying "Not Tracking" for a job the Applications board lists as Viewed.
    if (job.isNew) {
      viewMutation.mutate(job.id, refresh);
    }
    // Only fire once on mount — not when job changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [cautionOpen, setCautionOpen] = useState(false);
  const isNeedsReview = job.validation.status === 'NEEDS_REVIEW';

  const handleApplyClick = (e: React.MouseEvent) => {
    if (isNeedsReview && !cautionOpen) {
      e.preventDefault();
      setCautionOpen(true);
    }
  };

  const handleConfirmCaution = () => {
    setCautionOpen(false);
    window.open(job.applicationUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 p-4 border rounded-lg bg-card">
      <div className="flex items-center gap-4">
        {job.tracker.saved ? (
          <Button
            variant="secondary"
            onClick={() => saveMutation.mutate({ jobId: job.id, saved: false }, refresh)}
            disabled={saveMutation.isPending}
          >
            <BookmarkCheck className="mr-2 h-4 w-4" />
            Saved
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={() => saveMutation.mutate({ jobId: job.id, saved: true }, refresh)}
            disabled={saveMutation.isPending}
          >
            <Bookmark className="mr-2 h-4 w-4" />
            Save Job
          </Button>
        )}

        <div className="flex items-center gap-2">
          <span id="tracker-status-label" className="text-sm text-muted-foreground">
            Status:
          </span>
          <Select
            items={STATUS_LABELS}
            value={optimisticStatus}
            onValueChange={(val: string | null) => {
              if (!val) return;
              startTransition(() => {
                setOptimisticStatus(val);
              });
              if (val === 'UNTRACKED') {
                // "Not Tracking" has to undo the tracker row, or the option is a dead control.
                if (job.tracker.status) removeMutation.mutate(job.id, refresh);
                return;
              }
              trackerMutation.mutate({ jobId: job.id, status: val as ApplicationStatus }, refresh);
            }}
          >
            <SelectTrigger className="w-[160px]" aria-labelledby="tracker-status-label">
              <SelectValue placeholder="Update Status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {cautionOpen ? (
        <div
          role="alertdialog"
          aria-label="Caution: unverified job"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <span className="font-medium">This job isn&apos;t verified. Open anyway?</span>
          <Button
            size="sm"
            variant="default"
            data-testid="apply-caution-confirm"
            onClick={handleConfirmCaution}
          >
            Open anyway
          </Button>
          <Button size="sm" variant="outline" onClick={() => setCautionOpen(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <a
          href={job.applicationUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleApplyClick}
          className={buttonVariants({ size: 'lg', className: 'w-full sm:w-auto' })}
        >
          Apply Now
          <ExternalLink className="ml-2 h-4 w-4" />
        </a>
      )}
    </div>
  );
}
