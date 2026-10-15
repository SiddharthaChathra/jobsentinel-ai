export const queryKeys = {
  jobs: {
    all: ['jobs'] as const,
    list: (filters: unknown) => [...queryKeys.jobs.all, 'list', filters] as const,
    detail: (id: string) => [...queryKeys.jobs.all, 'detail', id] as const,
    saved: ['savedJobs'] as const,
    applications: ['applications'] as const,
  },
  dashboard: {
    summary: ['dashboard', 'summary'] as const,
  },
  user: {
    all: ['user'] as const,
    profile: ['user', 'profile'] as const,
    /** `GET /profile` — the confirmed resume profile (`profile` above is `GET /me`). */
    resumeProfile: ['user', 'resume-profile'] as const,
    preferences: ['user', 'preferences'] as const,
    settings: ['user', 'settings'] as const,
    resume: ['user', 'resume'] as const,
  },
  system: {
    all: ['system'] as const,
    status: ['system', 'status'] as const,
    sources: ['system', 'sources'] as const,
    scans: (sourceId?: string) => ['system', 'scans', sourceId] as const,
  },
};
