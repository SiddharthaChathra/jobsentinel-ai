/** Workflows GitHub must keep running; each is checked by `WorkflowWatchService` (D125). */
export const WATCHED_WORKFLOWS = [
  { file: 'backup.yml', label: 'Weekly encrypted backup' },
  { file: 'uptime.yml', label: 'Uptime check' },
] as const;

/** A watched workflow is stale past this many days without a run (owner, 2026-10-18). */
export const WORKFLOW_MAX_AGE_DAYS = 10;

export interface WorkflowState {
  /** GitHub's `state`: active, disabled_inactivity, disabled_manually, … */
  state: string;
  lastRunAt: Date | null;
}

/**
 * Why a workflow needs the owner's attention, or null when it is fine (D125). GitHub disables a
 * public repository's scheduled workflows after 60 days without repository activity; a disabled
 * or silent workflow means no backups or no uptime alerts, and nothing else would say so.
 */
export function workflowProblem(
  w: WorkflowState,
  now: Date,
  maxAgeDays = WORKFLOW_MAX_AGE_DAYS,
): string | null {
  if (w.state !== 'active') return `GitHub reports it as ${w.state.replace(/_/g, ' ')}`;
  if (!w.lastRunAt) return 'it has never run';
  const days = (now.getTime() - w.lastRunAt.getTime()) / 86_400_000;
  return days > maxAgeDays ? `last run ${Math.floor(days)} days ago` : null;
}
