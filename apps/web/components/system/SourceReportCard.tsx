'use client';

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSourceReport, useResumeSource } from '@/hooks/useSystem';
import { queryKeys } from '@/lib/queryKeys';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Loader2,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Shield,
  Play,
} from 'lucide-react';
import { RelativeTime } from '@/components/common/RelativeTime';
import { ApiError } from '@/lib/api';
import type { SourceReportRow, SourceHealth, RejectReason } from '@/lib/types/system';

// ── Constants ──────────────────────────────────────────────────────────────────

const HEALTH_CONFIG: Record<SourceHealth, { label: string; tooltip: string; color: string }> = {
  OK: {
    label: 'OK',
    tooltip: 'Finding fresher jobs',
    color: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  },
  KEPT_ZERO: {
    label: 'Kept Zero',
    tooltip: 'Collects jobs, none fit',
    color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  },
  COLLECTED_NOTHING: {
    label: 'Nothing Found',
    tooltip: 'Found nothing; may be broken',
    color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  },
  ERRORS: {
    label: 'Errors',
    tooltip: 'Failing; retrying with backoff',
    color: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  },
  PAUSED: {
    label: 'Paused',
    tooltip: 'Auto-paused',
    color: 'bg-gray-100 text-gray-800 dark:bg-gray-700/60 dark:text-gray-300',
  },
};

/** Display names for reject reasons. PENDING is separate ("Still processing", not a rejection). */
const REJECT_LABELS: Record<RejectReason, string> = {
  LOCATION: 'Outside India',
  EXPERIENCE: 'Asks for experience',
  BATCH: 'Wrong batch',
  CATEGORY: 'Not engineering',
  VALIDATION: 'Failed validation',
  EXPIRED: 'Closed',
  STALE: 'Older than 60 days',
  PENDING: 'Still processing',
  OTHER: 'Other',
};

const HEALTH_SORT_ORDER: Record<SourceHealth, number> = {
  PAUSED: 0,
  KEPT_ZERO: 1,
  COLLECTED_NOTHING: 2,
  ERRORS: 3,
  OK: 4,
};

const STORAGE_KEY = 'source-report-days';

function readStoredDays(): 7 | 30 {
  if (typeof window === 'undefined') return 30;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === '7') return 7;
  } catch {
    // localStorage may throw in private browsing
  }
  return 30;
}

function storeSelectedDays(d: 7 | 30) {
  try {
    localStorage.setItem(STORAGE_KEY, String(d));
  } catch {
    // ignored
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return 'Never';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return 'Invalid date';
  }
}

function sortSources(sources: SourceReportRow[]): SourceReportRow[] {
  return [...sources].sort((a, b) => {
    const hd = HEALTH_SORT_ORDER[a.health] - HEALTH_SORT_ORDER[b.health];
    if (hd !== 0) return hd;
    return b.collected - a.collected;
  });
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function HealthBadge({ health, id }: { health: SourceHealth; id: string }) {
  const cfg = HEALTH_CONFIG[health] ?? HEALTH_CONFIG.OK;
  return (
    <span
      data-testid={`source-health-${id}`}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.color}`}
      title={cfg.tooltip}
      aria-label={`${cfg.label}: ${cfg.tooltip}`}
    >
      {cfg.label}
    </span>
  );
}

function RejectedBreakdown({ rejected }: { rejected: Record<string, number> }) {
  const entries = Object.entries(rejected).filter(
    ([reason, count]) => count > 0 && reason !== 'PENDING',
  );
  const pending = rejected.PENDING ?? 0;

  if (entries.length === 0 && pending === 0) return null;

  return (
    <div className="mt-1 space-y-0.5">
      {entries.map(([reason, count]) => (
        <div key={reason} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-medium tabular-nums">{count}</span>
          <span>{REJECT_LABELS[reason as RejectReason] ?? reason}</span>
        </div>
      ))}
      {pending > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
          <span className="font-medium tabular-nums">{pending}</span>
          <span>Still processing</span>
        </div>
      )}
    </div>
  );
}

function ExpandableError({ error }: { error: string }) {
  const [expanded, setExpanded] = useState(false);
  const truncated = error.length > 80 ? error.slice(0, 80) + '…' : error;

  return (
    <div className="text-xs text-destructive">
      <span>{expanded ? error : truncated}</span>
      {error.length > 80 && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="ml-1 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={expanded ? 'Collapse error' : 'Expand error'}
        >
          {expanded ? (
            <ChevronUp className="inline h-3 w-3" />
          ) : (
            <ChevronDown className="inline h-3 w-3" />
          )}
        </button>
      )}
    </div>
  );
}

function ResumeButton({ source }: { source: SourceReportRow }) {
  const resumeMutation = useResumeSource();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleResume = useCallback(async () => {
    setFeedback(null);
    try {
      await resumeMutation.mutateAsync(source.id);
      setFeedback('Source resumed successfully');
      setConfirming(false);
    } catch (err) {
      setConfirming(false);
      if (err instanceof ApiError) {
        if (err.code === 'SOURCE_NOT_PAUSED') {
          setFeedback('Already active');
          qc.invalidateQueries({ queryKey: queryKeys.system.all });
        } else if (err.status === 404) {
          setFeedback('Source no longer exists');
        } else {
          setFeedback(err.message);
        }
      } else {
        setFeedback('Failed to resume source');
      }
    }
  }, [qc, resumeMutation, source.id]);

  return (
    <div className="mt-2 space-y-1">
      {!confirming && (
        <Button
          data-testid={`source-resume-${source.id}`}
          variant="outline"
          size="sm"
          onClick={() => setConfirming(true)}
          disabled={resumeMutation.isPending}
          aria-label={`Resume source ${source.name}`}
        >
          {resumeMutation.isPending ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <Play className="mr-1 h-3 w-3" />
          )}
          Resume
        </Button>
      )}

      {confirming && (
        <div
          className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 dark:border-amber-700 dark:bg-amber-900/20"
          role="alertdialog"
          aria-label="Confirm resume source"
        >
          <span className="text-xs">Resume this source?</span>
          <Button
            data-testid="source-resume-confirm"
            variant="default"
            size="sm"
            onClick={handleResume}
            disabled={resumeMutation.isPending}
          >
            {resumeMutation.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Confirm
          </Button>
          <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      )}

      {feedback && (
        <p className="text-xs text-muted-foreground" role="status">
          {feedback}
        </p>
      )}
    </div>
  );
}

// ── Source row (card on mobile, table row on desktop) ──────────────────────────

function SourceRow({ source }: { source: SourceReportRow }) {
  const isPaused = source.health === 'PAUSED';

  return (
    <div
      data-testid={`source-row-${source.id}`}
      className={`rounded-lg border p-4 transition-colors ${
        isPaused ? 'border-gray-300 bg-muted/30 dark:border-gray-700' : ''
      }`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold truncate">{source.name}</h3>
            <HealthBadge health={source.health} id={source.id} />
            {source.pauseExempt && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                title="India-scoped: alerted, never paused"
                data-testid={`source-exempt-${source.id}`}
              >
                <Shield className="h-3 w-3" />
                Exempt from auto-pause
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            <span>{source.adapter}</span>
            <span>{source.type}</span>
            {source.company && <span>{source.company.name}</span>}
          </div>
        </div>
      </div>

      {/* Paused info */}
      {isPaused && source.pausedReason && (
        <div className="mt-2 rounded border-l-4 border-amber-400 bg-amber-50 p-2 text-xs dark:border-amber-600 dark:bg-amber-900/20">
          <div className="font-medium text-amber-800 dark:text-amber-300">
            Paused:{' '}
            {source.pausedAt ? (
              <span>
                {formatDate(source.pausedAt)} (<RelativeTime date={source.pausedAt} />)
              </span>
            ) : (
              'Never'
            )}
          </div>
          <div className="mt-0.5 text-amber-700 dark:text-amber-400">{source.pausedReason}</div>
        </div>
      )}

      {/* Stats grid */}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <div>
          <span className="text-muted-foreground">Collected</span>
          <span className="ml-1 font-medium tabular-nums">{source.collected}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Kept</span>
          <span className="ml-1 font-medium tabular-nums">{source.kept}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Last kept</span>
          <span className="ml-1">
            {source.lastKeptAt ? (
              <span title={formatDate(source.lastKeptAt)}>
                <RelativeTime date={source.lastKeptAt} />
              </span>
            ) : (
              'Never'
            )}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">Last scan</span>
          <span className="ml-1">
            {source.lastSuccessfulScan ? (
              <span title={formatDate(source.lastSuccessfulScan)}>
                <RelativeTime date={source.lastSuccessfulScan} />
              </span>
            ) : (
              'Never'
            )}
          </span>
        </div>
      </div>

      {/* Rejected breakdown */}
      <RejectedBreakdown rejected={source.rejected} />

      {/* Last error */}
      {source.lastError && (
        <div className="mt-2">
          <ExpandableError error={source.lastError} />
        </div>
      )}

      {/* Resume button (only for paused sources) */}
      {isPaused && <ResumeButton source={source} />}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function SourceReportCard({ isAdmin }: { isAdmin: boolean }) {
  const [days, setDays] = useState<7 | 30>(readStoredDays);
  const [healthFilter, setHealthFilter] = useState<SourceHealth | 'ALL'>('ALL');

  const { data: report, isLoading, error, refetch } = useSourceReport(days, isAdmin);

  if (!isAdmin) return null;

  const handleDaysChange = (d: 7 | 30) => {
    setDays(d);
    storeSelectedDays(d);
  };

  // Loading skeleton
  if (isLoading) {
    return (
      <Card data-testid="source-report">
        <CardHeader>
          <CardTitle>Source Report Card</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3" role="status" aria-label="Loading source report">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card data-testid="source-report">
        <CardHeader>
          <CardTitle>Source Report Card</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive" data-testid="source-report-error">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Failed to load report</AlertTitle>
            <AlertDescription>
              {error instanceof ApiError ? error.message : 'An unexpected error occurred.'}
            </AlertDescription>
          </Alert>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
            <RefreshCw className="mr-1 h-3 w-3" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (!report || report.sources.length === 0) {
    return (
      <Card data-testid="source-report">
        <CardHeader>
          <CardTitle>Source Report Card</CardTitle>
        </CardHeader>
        <CardContent data-testid="source-report-empty">
          <p className="text-sm text-muted-foreground">
            No sources configured yet. Add job sources to see their report card here.
          </p>
        </CardContent>
      </Card>
    );
  }

  const keptPercent =
    report.totals.collected > 0
      ? ((report.totals.kept / report.totals.collected) * 100).toFixed(1)
      : '0.0';

  const sorted = sortSources(report.sources);
  const filtered =
    healthFilter === 'ALL' ? sorted : sorted.filter((s) => s.health === healthFilter);

  const healthCounts = report.sources.reduce(
    (acc, s) => {
      acc[s.health] = (acc[s.health] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <Card data-testid="source-report">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Source Report Card</CardTitle>
          {/* Days toggle */}
          <div
            className="flex items-center gap-1 rounded-lg border p-0.5"
            role="radiogroup"
            aria-label="Report period"
          >
            <button
              data-testid="source-report-days-7"
              type="button"
              role="radio"
              aria-checked={days === 7}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                days === 7 ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              }`}
              onClick={() => handleDaysChange(7)}
            >
              7 days
            </button>
            <button
              data-testid="source-report-days-30"
              type="button"
              role="radio"
              aria-checked={days === 30}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                days === 30 ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              }`}
              onClick={() => handleDaysChange(30)}
            >
              30 days
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Totals strip */}
        <div className="flex flex-wrap gap-4 rounded-lg bg-muted/50 px-4 py-3">
          <div className="text-center">
            <div className="text-2xl font-bold tabular-nums">{report.totals.collected}</div>
            <div className="text-xs text-muted-foreground">Collected</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold tabular-nums">{report.totals.kept}</div>
            <div className="text-xs text-muted-foreground">Kept</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold tabular-nums">{keptPercent}%</div>
            <div className="text-xs text-muted-foreground">Kept %</div>
          </div>
        </div>

        {/* Health filter */}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by health">
          <button
            type="button"
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              healthFilter === 'ALL' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
            }`}
            onClick={() => setHealthFilter('ALL')}
          >
            All ({report.sources.length})
          </button>
          {(['PAUSED', 'KEPT_ZERO', 'COLLECTED_NOTHING', 'ERRORS', 'OK'] as const).map((h) =>
            (healthCounts[h] ?? 0) > 0 ? (
              <button
                key={h}
                type="button"
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  healthFilter === h ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                }`}
                onClick={() => setHealthFilter(h)}
              >
                {HEALTH_CONFIG[h].label} ({healthCounts[h]})
              </button>
            ) : null,
          )}
        </div>

        {/* Source cards */}
        <div className="space-y-3">
          {filtered.map((source) => (
            <SourceRow key={source.id} source={source} />
          ))}
          {filtered.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No sources match the selected filter.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
