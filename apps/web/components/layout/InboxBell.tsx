'use client';

import { useQuery } from '@tanstack/react-query';
import type { InboxSummary } from '@jobsentinel/types';
import { useApi } from '@/hooks/use-api';
import { cn } from '@/lib/utils';

/**
 * Unread count for the inbox. Rendered as a number beside the sidebar link and as a dot on the
 * mobile tab icon. It fails silently: a badge is never worth showing an error over.
 */
export function InboxBell({ variant = 'count' }: { variant?: 'count' | 'dot' }) {
  const api = useApi();
  const { data } = useQuery({
    queryKey: ['notifications', 'summary'],
    queryFn: async () => (await api.get<InboxSummary>('/notifications/summary')).data,
    refetchInterval: 60_000,
    retry: false,
  });

  const unread = data?.unread ?? 0;
  if (unread === 0) return null;

  if (variant === 'dot') {
    return (
      <span
        aria-label={`${unread} unread`}
        className="absolute -right-1.5 -top-0.5 size-2 rounded-full bg-primary ring-2 ring-background"
      />
    );
  }

  return (
    <span
      className={cn(
        'ml-auto min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-center text-[11px] font-medium leading-none text-primary-foreground',
      )}
    >
      {unread > 99 ? '99+' : unread}
    </span>
  );
}
