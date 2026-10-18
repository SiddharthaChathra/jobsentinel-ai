'use client';

import Link from 'next/link';
import { Bell, Clock, Calendar, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useReminders, useSnoozeReminder, useDismissReminder } from '@/hooks/useReminders';
import { cn } from '@/lib/utils';
import type { ReminderItem } from '@jobsentinel/types';

export function RemindersSection() {
  const { data: reminders, isLoading, isError } = useReminders();
  const snooze = useSnoozeReminder();
  const dismiss = useDismissReminder();

  if (isLoading) {
    return (
      <section aria-label="Reminders" className="mb-6 space-y-3">
        <div className="flex items-center gap-2">
          <Clock className="size-4 text-muted-foreground animate-pulse" />
          <h2 className="text-base font-semibold tracking-tight">Reminders</h2>
        </div>
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg border border-border/60 bg-muted/40"
            />
          ))}
        </div>
      </section>
    );
  }

  if (isError) {
    return (
      <section aria-label="Reminders" className="mb-6">
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          Could not load reminders.
        </p>
      </section>
    );
  }

  if (!reminders || reminders.length === 0) {
    // Hide the section when the list is empty
    return null;
  }

  // DUE items first, then UPCOMING
  const sortedReminders = [...reminders].sort((a, b) => {
    if (a.state === 'DUE' && b.state !== 'DUE') return -1;
    if (a.state !== 'DUE' && b.state === 'DUE') return 1;
    return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
  });

  return (
    <section aria-label="Reminders" className="mb-6 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Clock className="size-4 text-primary" />
          <h2 className="text-base font-semibold tracking-tight">Reminders</h2>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {sortedReminders.length}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        {sortedReminders.map((reminder) => (
          <ReminderRow
            key={reminder.id}
            reminder={reminder}
            onSnooze={(hours) => snooze.mutate({ id: reminder.id, hours })}
            onDismiss={() => dismiss.mutate(reminder.id)}
            isSnoozePending={snooze.isPending}
            isDismissPending={dismiss.isPending}
          />
        ))}
      </div>
    </section>
  );
}

interface ReminderRowProps {
  reminder: ReminderItem;
  onSnooze: (hours?: number) => void;
  onDismiss: () => void;
  isSnoozePending: boolean;
  isDismissPending: boolean;
}

export function ReminderRow({
  reminder,
  onSnooze,
  onDismiss,
  isSnoozePending,
  isDismissPending,
}: ReminderRowProps) {
  const isDue = reminder.state === 'DUE';
  const localDate = new Date(reminder.dueAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div
      data-testid={`reminder-${reminder.id}`}
      className={cn(
        'flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border p-3 sm:p-4 transition-colors',
        isDue
          ? 'border-amber-300 bg-amber-50/70 text-amber-950 dark:border-amber-700/70 dark:bg-amber-950/30 dark:text-amber-100 shadow-sm'
          : 'border-border/70 bg-card text-card-foreground',
      )}
    >
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <div
          className={cn(
            'mt-0.5 grid size-7 shrink-0 place-items-center rounded-md text-xs font-semibold',
            isDue
              ? 'bg-amber-200/80 text-amber-900 dark:bg-amber-900/60 dark:text-amber-200'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {isDue ? <Bell className="size-3.5" /> : <Calendar className="size-3.5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                isDue
                  ? 'bg-amber-200/90 text-amber-900 dark:bg-amber-900/80 dark:text-amber-200'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {reminder.state}
            </span>
            <span className="text-xs text-muted-foreground">{localDate}</span>
          </div>

          <Link
            href={`/jobs/${reminder.job.id}`}
            className="mt-1 block text-sm font-medium hover:underline leading-snug break-words"
          >
            {reminder.message}
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 shrink-0 self-end sm:self-center">
        {/* Default 1-day Snooze button with required selector */}
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid={`reminder-snooze-${reminder.id}`}
          onClick={() => onSnooze(24)}
          disabled={isSnoozePending}
          className="h-8 text-xs"
          title="Snooze 1 day (default)"
        >
          Snooze 1d
        </Button>

        {/* Quick alternative snooze options: 1 hour and 3 days */}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          data-testid={`reminder-snooze-1h-${reminder.id}`}
          onClick={() => onSnooze(1)}
          disabled={isSnoozePending}
          className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
          title="Snooze 1 hour"
        >
          1h
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          data-testid={`reminder-snooze-3d-${reminder.id}`}
          onClick={() => onSnooze(72)}
          disabled={isSnoozePending}
          className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
          title="Snooze 3 days"
        >
          3d
        </Button>

        {/* Dismiss button with required selector */}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          data-testid={`reminder-dismiss-${reminder.id}`}
          onClick={onDismiss}
          disabled={isDismissPending}
          className="h-8 text-xs text-muted-foreground hover:text-destructive"
        >
          <Check className="mr-1 size-3" />
          Dismiss
        </Button>
      </div>
    </div>
  );
}
