'use client';

import { useSystemStatus, useSources, useTriggerScan } from '@/hooks/useSystem';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Activity, Database, Server, RefreshCw } from 'lucide-react';
import { RelativeTime } from '@/components/common/RelativeTime';

export default function SystemPage() {
  const { data: status, isLoading: statusLoading } = useSystemStatus();
  const { data: sources, isLoading: sourcesLoading } = useSources();
  const scanMutation = useTriggerScan();

  if (statusLoading || sourcesLoading) {
    return (
      <div className="p-8 flex justify-center">
        <Loader2 className="animate-spin h-6 w-6" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">System Status</h1>
        <p className="text-muted-foreground">
          Monitor worker health, data sources, and pipeline stats.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Worker Status</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {status?.worker?.alive ? (
                <span className="text-green-500">Online</span>
              ) : (
                <span className="text-destructive">Offline</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Last beat:{' '}
              {status?.worker?.lastBeatAt ? (
                <RelativeTime date={status.worker.lastBeatAt} />
              ) : (
                'Unknown'
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">AI Budget</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {status?.ai?.callsToday ?? 0} / {status?.ai?.callBudget ?? 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Tokens: {status?.ai?.tokensToday ?? 0} / {status?.ai?.tokenBudget ?? 0}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Jobs (24h)</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{status?.jobsLast24h?.new ?? 0}</div>
            <p className="text-xs text-muted-foreground">
              Found: {status?.jobsLast24h?.found ?? 0}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Data Sources</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{status?.sources?.active ?? 0}</div>
            <p className="text-xs text-muted-foreground">
              Active / {status?.sources?.total ?? 0} Total
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sources Configuration</CardTitle>
          <CardDescription>Managed job boards and career pages.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <div className="relative w-full overflow-auto">
              <table className="w-full caption-bottom text-sm">
                <thead className="[&_tr]:border-b bg-muted/50">
                  <tr className="border-b transition-colors">
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                      Name
                    </th>
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                      Status
                    </th>
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                      Last Scan
                    </th>
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                      Failures
                    </th>
                    <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {sources?.map((source) => (
                    <tr key={source.id} className="border-b transition-colors hover:bg-muted/50">
                      <td className="p-4 align-middle font-medium">{source.name}</td>
                      <td className="p-4 align-middle">
                        <Badge variant={source.status === 'ACTIVE' ? 'default' : 'secondary'}>
                          {source.status}
                        </Badge>
                      </td>
                      <td className="p-4 align-middle">
                        {source.lastSuccessfulScan ? (
                          <RelativeTime date={source.lastSuccessfulScan} />
                        ) : (
                          'Never'
                        )}
                      </td>
                      <td className="p-4 align-middle">{source.consecutiveFailures}</td>
                      <td className="p-4 align-middle text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => scanMutation.mutate(source.id)}
                          disabled={scanMutation.isPending || !source.enabled}
                        >
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Scan Now
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
