'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useApi } from '@/hooks/use-api';
import { cn } from '@/lib/utils';

/**
 * Save / unsave with an optimistic flip — the button is the main interaction in a long list and
 * must feel instant. On failure it reverts, so the UI never claims something the API refused.
 */
export function SaveButton({
  jobId,
  saved,
  className,
}: {
  jobId: string;
  saved: boolean;
  className?: string;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const [optimistic, setOptimistic] = useState(saved);

  const mutation = useMutation({
    mutationFn: (next: boolean) =>
      next ? api.post(`/jobs/${jobId}/save`) : api.delete(`/jobs/${jobId}/save`),
    onError: (_e, next) => setOptimistic(!next),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['jobs'] });
      void qc.invalidateQueries({ queryKey: ['saved-jobs'] });
    },
  });

  const toggle = (e: React.MouseEvent) => {
    // The card is a link; saving must not navigate.
    e.preventDefault();
    e.stopPropagation();
    const next = !optimistic;
    setOptimistic(next);
    mutation.mutate(next);
  };

  return (
    <Button
      type="button"
      variant={optimistic ? 'secondary' : 'outline'}
      size="sm"
      onClick={toggle}
      aria-pressed={optimistic}
      aria-label={optimistic ? 'Remove from saved' : 'Save job'}
      className={cn('gap-1.5', className)}
    >
      {optimistic ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
      {optimistic ? 'Saved' : 'Save'}
    </Button>
  );
}
