/**
 * Re-export canonical API types from @jobsentinel/types.
 * UI code imports from here so a single grep finds every consumer.
 * Never hand-write an interface that already exists in the shared package.
 */
export type {
  JobCard,
  JobDetail,
  JobMatchSummary,
  JobMatchDetail,
  JobValidationSummary,
  JobValidationDetail,
  JobCompanyRef,
  JobLocation,
  JobSalary,
  JobEventItem,
  JobSourceRef,
  TrackerState,
  JobsQuery,
  JobSort,
  JobActivity,
  ApplicationItem,
  ApplicationUpsert,
  ApplicationsQuery,
  ApplicationHistoryEntry,
  SavedJobsQuery,
  NotInterestedInput,
  DashboardSummary,
  ReviewJobCard,
  HeldInfo,
  HeldKind,
  PostingType,
  MatchScoring,
  SourceAttribution,
} from '@jobsentinel/types';
