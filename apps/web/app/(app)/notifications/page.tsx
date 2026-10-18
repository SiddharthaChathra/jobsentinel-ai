'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, Calendar, CheckCheck, Clock, Info } from 'lucide-react';
import type { InboxItem } from '@jobsentinel/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { RelativeTime } from '@/components/common/RelativeTime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useApi } from '@/hooks/use-api';
import { cn } from '@/lib/utils';

/** The web inbox — the complete record of every alert, whether or not Telegram delivered it. */
export default function NotificationsPage() {
  const api = useApi();
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: async () => (await api.get<InboxItem[]>('/notifications', { limit: 50 })).data,
  });

  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markOne = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const items = data ?? [];
  const unread = items.filter((i) => i.readAt === null).length;

  return (
    <>
      <PageHeader
        title="Inbox"
        description="Every alert JobSentinel has raised, newest first."
        actions={
          unread > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
            >
              <CheckCheck className="mr-1.5 size-4" />
              Mark all read
            </Button>
          ) : null
        }
      />

      {isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-xl border border-border/60 bg-muted/40"
            />
          ))}
        </div>
      )}

      {isError && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Could not load your inbox. Is the API running?
        </p>
      )}

      {!isLoading && !isError && items.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <BellOff className="size-8 text-muted-foreground" />
          <div>
            <p className="font-medium">No alerts yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              When a verified job matches your profile strongly, it lands here and on Telegram.
            </p>
          </div>
        </div>
      )}

      <ul className="space-y-2.5">
        {items.map((item) => {
          const isUnread = item.readAt === null;
          const body = (
            <div
              className={cn(
                'rounded-xl border p-4 transition-colors',
                isUnread ? 'border-primary/30 bg-primary/[0.04]' : 'border-border/60 bg-card',
              )}
            >
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    'mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg',
                    isUnread ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {item.type === 'REMINDER' ? (
                    <Clock className="size-4" />
                  ) : item.type === 'WEEKLY' ? (
                    <Calendar className="size-4" />
                  ) : item.type === 'SYSTEM' ? (
                    <Info className="size-4" />
                  ) : (
                    <Bell className="size-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium leading-snug">{item.title}</p>
                    {item.score !== null && (
                      <Badge variant="secondary" className="shrink-0">
                        {item.score}%
                      </Badge>
                    )}
                    {item.type === 'REMINDER' && (
                      <Badge
                        variant="outline"
                        className="border-amber-300 dark:border-amber-700 text-[10px]"
                      >
                        Reminder
                      </Badge>
                    )}
                    {item.type === 'WEEKLY' && (
                      <Badge
                        variant="outline"
                        className="border-indigo-300 dark:border-indigo-700 text-[10px]"
                      >
                        Weekly
                      </Badge>
                    )}
                    {item.type === 'SYSTEM' && (
                      <Badge variant="outline" className="text-[10px]">
                        System
                      </Badge>
                    )}
                    {isUnread && <span className="size-1.5 rounded-full bg-primary" />}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                    {item.body}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    <RelativeTime date={item.createdAt} />
                  </p>
                </div>
              </div>
            </div>
          );

          return (
            <li key={item.id} onClick={() => isUnread && markOne.mutate(item.id)}>
              {item.jobId ? <Link href={`/jobs/${item.jobId}`}>{body}</Link> : body}
            </li>
          );
        })}
      </ul>
    </>
  );
}
