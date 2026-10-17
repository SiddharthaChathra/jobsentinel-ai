'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from './use-api';
import { queryKeys } from '../lib/queryKeys';
import type {
  JobsQuery,
  JobCard,
  JobDetail,
  DashboardSummary,
  ApplicationItem,
  ApplicationUpsert,
  TrackerState,
  NotInterestedInput,
  ReviewJobCard,
} from '../lib/types/jobs';

// ────────────────────────────────────────────────────────────────────
// Jobs list  GET /jobs -> { data: JobCard[], meta: { nextCursor } }
// ────────────────────────────────────────────────────────────────────
export function useJobs(query: JobsQuery) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.jobs.list(query),
    queryFn: async () => {
      const res = await api.get<JobCard[]>(
        '/jobs',
        query as unknown as Record<string, string | number | boolean | string[] | undefined>,
      );
      return { data: res.data, meta: res.meta };
    },
  });
}

// ────────────────────────────────────────────────────────────────────
// Needs review list  GET /jobs/needs-review -> { data: ReviewJobCard[], meta: { nextCursor } }
// ────────────────────────────────────────────────────────────────────
export function useNeedsReview(query: JobsQuery, options?: { enabled?: boolean }) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.jobs.needsReview(query),
    queryFn: async () => {
      const res = await api.get<ReviewJobCard[]>(
        '/jobs/needs-review',
        query as unknown as Record<string, string | number | boolean | string[] | undefined>,
      );
      return { data: res.data, meta: res.meta };
    },
    enabled: options?.enabled,
  });
}

// ────────────────────────────────────────────────────────────────────
// Job detail  GET /jobs/:id -> JobDetail
// ────────────────────────────────────────────────────────────────────
export function useJob(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.jobs.detail(id),
    queryFn: async () => {
      const { data } = await api.get<JobDetail>(`/jobs/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

// ────────────────────────────────────────────────────────────────────
// Dashboard  GET /dashboard/summary -> DashboardSummary
// ────────────────────────────────────────────────────────────────────
export function useDashboard() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.dashboard.summary,
    queryFn: async () => {
      const { data } = await api.get<DashboardSummary>('/dashboard/summary');
      return data;
    },
  });
}

// ────────────────────────────────────────────────────────────────────
// Saved jobs  GET /saved-jobs -> { data: JobCard[], meta }
// ────────────────────────────────────────────────────────────────────
export function useSavedJobs(cursor?: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.jobs.saved,
    queryFn: async () => {
      const res = await api.get<JobCard[]>('/saved-jobs', cursor ? { cursor } : {});
      return { data: res.data, meta: res.meta };
    },
  });
}

// ────────────────────────────────────────────────────────────────────
// Applications  GET /applications -> { data: ApplicationItem[], meta }
// ────────────────────────────────────────────────────────────────────
export function useApplications(status?: string[]) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.jobs.applications,
    queryFn: async () => {
      const res = await api.get<ApplicationItem[]>(
        '/applications',
        status && status.length > 0 ? { status } : {},
      );
      return { data: res.data, meta: res.meta };
    },
  });
}

// ────────────────────────────────────────────────────────────────────
// Mutations
// ────────────────────────────────────────────────────────────────────

/** POST /jobs/:id/view -> TrackerState */
export function useViewJob() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => {
      const { data } = await api.post<TrackerState>(`/jobs/${jobId}/view`);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
  });
}

/** POST /jobs/:id/save -> TrackerState */
export function useSaveJob() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ jobId, saved }: { jobId: string; saved: boolean }) => {
      if (saved) {
        const { data } = await api.post<TrackerState>(`/jobs/${jobId}/save`);
        return data;
      }
      const { data } = await api.delete<TrackerState>(`/jobs/${jobId}/save`);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.jobs.all });
      // `savedJobs` is its own root key, so the `jobs` prefix above does not reach it.
      qc.invalidateQueries({ queryKey: queryKeys.jobs.saved });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.summary });
    },
  });
}

/** POST /jobs/:id/not-interested -> TrackerState */
export function useNotInterested() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ jobId, reason }: { jobId: string } & NotInterestedInput) => {
      const { data } = await api.post<TrackerState>(`/jobs/${jobId}/not-interested`, { reason });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
  });
}

/** PUT /applications/:jobId -> ApplicationItem */
export function useTracker() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ jobId, ...body }: { jobId: string } & ApplicationUpsert) => {
      const { data } = await api.put<ApplicationItem>(`/applications/${jobId}`, body);
      return data;
    },
    onMutate: async (variables) => {
      await qc.cancelQueries({ queryKey: queryKeys.jobs.detail(variables.jobId) });
      const previousJob = qc.getQueryData<JobDetail>(queryKeys.jobs.detail(variables.jobId));

      if (previousJob) {
        qc.setQueryData<JobDetail>(queryKeys.jobs.detail(variables.jobId), {
          ...previousJob,
          tracker: {
            ...(previousJob.tracker ?? {}),
            status: variables.status,
          },
        });
      }

      return { previousJob };
    },
    onError: (err, variables, context) => {
      if (context?.previousJob) {
        qc.setQueryData(queryKeys.jobs.detail(variables.jobId), context.previousJob);
      }
      alert('Failed to update application status.');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.jobs.all });
      qc.invalidateQueries({ queryKey: queryKeys.jobs.applications });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.summary });
    },
  });
}

/** DELETE /applications/:jobId -> 204 */
export function useRemoveApplication() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => {
      await api.delete(`/applications/${jobId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.jobs.all });
      qc.invalidateQueries({ queryKey: queryKeys.jobs.applications });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.summary });
    },
  });
}

/** POST /jobs/:id/review -> JobDetail */
export function useReviewJob() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      jobId,
      decision,
      note,
    }: {
      jobId: string;
      decision: 'ACCEPT' | 'REJECT';
      note?: string;
    }) => {
      const { data } = await api.post<JobDetail>(`/jobs/${jobId}/review`, { decision, note });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.jobs.all });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.summary });
    },
  });
}

/** POST /jobs/:id/revalidate -> 202 */
export function useRevalidateJob() {
  const api = useApi();
  return useMutation({
    mutationFn: async (jobId: string) => {
      await api.post(`/jobs/${jobId}/revalidate`);
    },
  });
}
