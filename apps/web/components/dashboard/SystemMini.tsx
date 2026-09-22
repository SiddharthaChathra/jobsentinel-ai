import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DashboardSummary } from '@/lib/types/jobs';
import { Activity, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { RelativeTime } from '@/components/common/RelativeTime';

export function SystemMini({ summary }: { summary: DashboardSummary }) {
  const isHealthy = summary.system.workerAlive && summary.system.failingSources === 0;

  return (
    <Card className={!isHealthy ? 'border-destructive' : ''}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4" />
          System Status
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Worker Status</span>
          {summary.system.workerAlive ? (
            <span className="flex items-center gap-1 text-green-500">
              <CheckCircle2 className="h-4 w-4" /> Active
            </span>
          ) : (
            <span className="flex items-center gap-1 text-destructive">
              <AlertTriangle className="h-4 w-4" /> Offline
            </span>
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Failing Sources</span>
          {summary.system.failingSources > 0 ? (
            <span className="text-destructive font-medium">{summary.system.failingSources}</span>
          ) : (
            <span>0</span>
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Last Scan</span>
          <span>
            {summary.system.lastScanAt ? (
              <RelativeTime date={summary.system.lastScanAt} />
            ) : (
              'Never'
            )}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
