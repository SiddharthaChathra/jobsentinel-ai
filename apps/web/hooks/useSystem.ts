'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from './use-api';
import { queryKeys } from '../lib/queryKeys';
import type { SystemStatus, SourceSummary, ScanRun } from '../lib/types/system';

export function useSystemStatus() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.system.status,
    queryFn: async () => {
      const { data } = await api.get<SystemStatus>('/system/status');
      return data;
    },
    refetchInterval: 30_000,
  });
}

/** `GET /sources` is admin-only (403 otherwise), so callers pass whether the user is an admin. */
export function useSources(enabled = true) {
  const api = useApi();
  return useQuery({
    enabled,
    queryKey: queryKeys.system.sources,
    queryFn: async () => {
      const { data } = await api.get<SourceSummary[]>('/sources');
      return data;
    },
  });
}

export function useTriggerScan() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sourceId: string) => {
      await api.post(`/sources/${sourceId}/scan`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.system.sources });
      qc.invalidateQueries({ queryKey: queryKeys.system.status });
    },
  });
}

export function useScanRuns(sourceId?: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.system.scans(sourceId),
    queryFn: async () => {
      const url = sourceId ? `/sources/${sourceId}/scan-runs` : '/sources/scan-runs';
      const { data } = await api.get<ScanRun[]>(url);
      return data;
    },
  });
}
