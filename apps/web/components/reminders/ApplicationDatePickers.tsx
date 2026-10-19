'use client';

import { useState, useTransition } from 'react';
import { Calendar, Clock, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useUpdateApplicationDates } from '@/hooks/useReminders';

export interface ApplicationDatePickersProps {
  jobId: string;
  interviewAt?: string | null;
  deadline?: string | null;
  followUpAt?: string | null;
  /** When true, only shows the deadline picker (e.g. for saved jobs). */
  deadlineOnly?: boolean;
  className?: string;
}

/** Parses "YYYY-MM-DD" date string and returns ISO string for 23:59:00.000 local time. */
export function dateToLocalEodIso(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return '';
  const date = new Date(year, month - 1, day, 23, 59, 0, 0);
  return date.toISOString();
}

/** Converts an ISO string into "YYYY-MM-DD" for HTML date input value. */
export function isoToLocalDateInput(isoStr?: string | null): string {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Converts an ISO string into "YYYY-MM-DDTHH:mm" for HTML datetime-local input. */
export function isoToLocalDateTimeInput(isoStr?: string | null): string {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${mins}`;
}

export function ApplicationDatePickers({
  jobId,
  interviewAt: initialInterviewAt,
  deadline: initialDeadline,
  followUpAt,
  deadlineOnly = false,
  className = '',
}: ApplicationDatePickersProps) {
  const updateDates = useUpdateApplicationDates();
  const [, startTransition] = useTransition();

  const [interviewVal, setInterviewVal] = useState<string>(
    isoToLocalDateTimeInput(initialInterviewAt),
  );
  const [deadlineVal, setDeadlineVal] = useState<string>(isoToLocalDateInput(initialDeadline));

  const handleInterviewChange = (val: string) => {
    setInterviewVal(val);
    if (!val) {
      updateDates.mutate({ jobId, interviewAt: null });
      return;
    }
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      startTransition(() => {
        updateDates.mutate({ jobId, interviewAt: d.toISOString() });
      });
    }
  };

  const handleClearInterview = () => {
    setInterviewVal('');
    updateDates.mutate({ jobId, interviewAt: null });
  };

  const handleDeadlineChange = (val: string) => {
    setDeadlineVal(val);
    if (!val) {
      updateDates.mutate({ jobId, deadline: null });
      return;
    }
    const iso = dateToLocalEodIso(val);
    if (iso) {
      startTransition(() => {
        updateDates.mutate({ jobId, deadline: iso });
      });
    }
  };

  const handleClearDeadline = () => {
    setDeadlineVal('');
    updateDates.mutate({ jobId, deadline: null });
  };

  const formattedFollowUp = followUpAt
    ? new Date(followUpAt).toLocaleDateString(undefined, {
        dateStyle: 'medium',
      })
    : null;

  return (
    <div className={`space-y-2 text-xs ${className}`}>
      {/* Read-only follow-up reminder */}
      {followUpAt && formattedFollowUp && (
        <div
          data-testid={`follow-up-${jobId}`}
          className="flex items-center gap-1.5 text-muted-foreground"
        >
          <Clock className="size-3 text-muted-foreground shrink-0" />
          <span>Follow-up reminder on {formattedFollowUp}</span>
        </div>
      )}

      <div data-testid={`date-pickers-${jobId}`} className="flex flex-col gap-2 w-full">
        {/* Interview Date & Time (not shown in deadline-only mode) */}
        {!deadlineOnly && (
          <div className="flex flex-col gap-1 w-full">
            <Label
              htmlFor={`interview-date-${jobId}`}
              className="text-[11px] font-medium text-muted-foreground"
            >
              Interview:
            </Label>
            <div className="flex items-center gap-1 w-full min-w-0">
              <input
                id={`interview-date-${jobId}`}
                data-testid={`interview-date-${jobId}`}
                type="datetime-local"
                value={interviewVal}
                onChange={(e) => handleInterviewChange(e.target.value)}
                className="h-7 w-full min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-0.5 text-xs text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:[color-scheme:dark]"
              />
              {interviewVal && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={handleClearInterview}
                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label="Clear interview date"
                  title="Clear interview date"
                >
                  <X className="size-3" />
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Deadline Picker */}
        <div className="flex flex-col gap-1 w-full">
          <Label
            htmlFor={`deadline-date-${jobId}`}
            className="text-[11px] font-medium text-muted-foreground flex items-center gap-1"
          >
            <Calendar className="size-3" />
            Deadline:
          </Label>
          <div className="flex items-center gap-1 w-full min-w-0">
            <input
              id={`deadline-date-${jobId}`}
              data-testid={`deadline-date-${jobId}`}
              type="date"
              value={deadlineVal}
              onChange={(e) => handleDeadlineChange(e.target.value)}
              className="h-7 w-full min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-0.5 text-xs text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:[color-scheme:dark]"
            />
            {deadlineVal && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleClearDeadline}
                className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="Clear deadline"
                title="Clear deadline"
              >
                <X className="size-3" />
              </Button>
            )}
          </div>
        </div>

        {updateDates.isPending && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            <span>Saving...</span>
          </div>
        )}
      </div>
    </div>
  );
}
