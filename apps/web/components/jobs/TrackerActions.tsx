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
import { useSaveJob, useTracker, useViewJob } from '@/hooks/useJobs';
import type { ApplicationStatus } from '@jobsentinel/types';
import { useEffect } from 'react';

export function TrackerActions({ job }: { job: JobDetail }) {
  const saveMutation = useSaveJob();
  const trackerMutation = useTracker();
  const viewMutation = useViewJob();

  // Record a view when the component mounts (the user opened the detail page).
  useEffect(() => {
    if (job.isNew) {
      viewMutation.mutate(job.id);
    }
    // Only fire once on mount — not when job changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 p-4 border rounded-lg bg-card">
      <div className="flex items-center gap-4">
        {job.tracker.saved ? (
          <Button
            variant="secondary"
            onClick={() => saveMutation.mutate({ jobId: job.id, saved: false })}
            disabled={saveMutation.isPending}
          >
            <BookmarkCheck className="mr-2 h-4 w-4" />
            Saved
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={() => saveMutation.mutate({ jobId: job.id, saved: true })}
            disabled={saveMutation.isPending}
          >
            <Bookmark className="mr-2 h-4 w-4" />
            Save Job
          </Button>
        )}

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Status:</span>
          <Select
            value={job.tracker.status || 'UNTRACKED'}
            onValueChange={(val: string | null) => {
              if (val && val !== 'UNTRACKED') {
                trackerMutation.mutate({
                  jobId: job.id,
                  status: val as ApplicationStatus,
                });
              }
            }}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Update Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="UNTRACKED">Not Tracking</SelectItem>
              <SelectItem value="VIEWED">Viewed</SelectItem>
              <SelectItem value="APPLIED">Applied</SelectItem>
              <SelectItem value="INTERVIEW">Interview</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
              <SelectItem value="SELECTED">Selected</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <a
        href={job.applicationUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonVariants({ size: 'lg', className: 'w-full sm:w-auto' })}
      >
        Apply Now
        <ExternalLink className="ml-2 h-4 w-4" />
      </a>
    </div>
  );
}
