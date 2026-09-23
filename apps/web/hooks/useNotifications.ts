'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  InboxItem,
  InboxSummary,
  NotificationSettings,
  NotificationSettingsInput,
  TelegramLinkStart,
  TelegramLinkState,
} from '@jobsentinel/types';
import { useApi } from './use-api';

const SETTINGS_KEY = ['notifications', 'settings'] as const;

export function useNotificationSettings() {
  const api = useApi();
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: async () => (await api.get<NotificationSettings>('/notifications/settings')).data,
  });
}

export function useUpdateNotificationSettings() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: NotificationSettingsInput) =>
      (await api.put<NotificationSettings>('/notifications/settings', patch)).data,
    onSuccess: (data) => qc.setQueryData(SETTINGS_KEY, data),
  });
}

/** Returns the `t.me` deep link to open or show as a QR; the bot completes the link. */
export function useStartTelegramLink() {
  const api = useApi();
  return useMutation({
    mutationFn: async () => (await api.post<TelegramLinkStart>('/telegram/link')).data,
  });
}

export function useUnlinkTelegram() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post<TelegramLinkState>('/telegram/unlink')).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: SETTINGS_KEY }),
  });
}

export function useSendTestAlert() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ channels: string[] }>('/notifications/test'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useInbox(limit = 50) {
  const api = useApi();
  return useQuery({
    queryKey: ['notifications', 'list', limit],
    queryFn: async () => (await api.get<InboxItem[]>('/notifications', { limit })).data,
  });
}

export function useInboxSummary() {
  const api = useApi();
  return useQuery({
    queryKey: ['notifications', 'summary'],
    queryFn: async () => (await api.get<InboxSummary>('/notifications/summary')).data,
    refetchInterval: 60_000,
    retry: false,
  });
}
