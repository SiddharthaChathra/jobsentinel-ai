'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from './use-api';
import { queryKeys } from '../lib/queryKeys';
import { ApiError } from '../lib/api';
import type {
  Me,
  MePatch,
  Preferences,
  PreferencesInput,
  Profile,
  Resume,
} from '../lib/types/user';

export function useMe() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.user.profile,
    queryFn: async () => {
      const { data } = await api.get<Me>('/me');
      return data;
    },
  });
}

export function useUpdateMe() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: MePatch) => {
      const { data } = await api.patch<Me>('/me', patch);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.user.profile });
    },
  });
}

export function usePreferences() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.user.preferences,
    queryFn: async () => {
      const { data } = await api.get<Preferences>('/preferences');
      return data;
    },
  });
}

export function useUpdatePreferences() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (prefs: Partial<PreferencesInput>) => {
      const { data } = await api.put<Preferences>('/preferences', prefs);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.user.preferences });
    },
  });
}

/** `GET /profile`; `null` when no profile has been confirmed yet (404 PROFILE_NOT_FOUND). */
export function useProfile() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.user.resumeProfile,
    queryFn: async () => {
      try {
        const { data } = await api.get<Profile>('/profile');
        return data;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
  });
}

export function useResume() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.user.resume,
    queryFn: async () => {
      const { data } = await api.get<Resume[]>('/resumes');
      // Return the active resume, or the first one
      return data.find((r) => r.isActive) ?? data[0] ?? null;
    },
  });
}
