'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApplicationDatesInput, ApplicationItem, ReminderItem } from '@jobsentinel/types';
import { useApi } from './use-api';
import { queryKeys } from '@/lib/queryKeys';

export const REMINDERS_KEY = ['reminders', 'list'] as const;

export function useReminders(withinDays?: number) {
  const api = useApi();
  return useQuery({
    queryKey: withinDays ? ['reminders', 'list', withinDays] : REMINDERS_KEY,
    queryFn: async () => {
      const res = await api.get<ReminderItem[]>('/reminders', withinDays ? { withinDays } : {});
      return res.data;
    },
  });
}

export function useSnoozeReminder() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, hours = 24 }: { id: string; hours?: number }) => {
      const res = await api.post<ReminderItem>(`/reminders/${id}/snooze`, {
        hours,
      });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminders'] });
    },
  });
}

export function useDismissReminder() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/reminders/${id}/dismiss`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminders'] });
    },
  });
}

export function useUpdateApplicationDates() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ jobId, ...dates }: { jobId: string } & ApplicationDatesInput) => {
      const res = await api.patch<ApplicationItem>(`/applications/${jobId}/dates`, dates);
      return res.data;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['reminders'] });
      qc.invalidateQueries({ queryKey: queryKeys.jobs.applications });
      qc.invalidateQueries({ queryKey: queryKeys.jobs.saved });
      qc.invalidateQueries({ queryKey: queryKeys.jobs.detail(variables.jobId) });
    },
  });
}
