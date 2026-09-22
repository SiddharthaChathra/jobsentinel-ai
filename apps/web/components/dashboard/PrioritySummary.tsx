import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DashboardSummary } from '@/lib/types/jobs';
import { Progress } from '@/components/ui/progress';

export function PrioritySummary({ summary }: { summary: DashboardSummary }) {
  const total =
    summary.byPriority.veryHigh +
    summary.byPriority.high +
    summary.byPriority.medium +
    summary.byPriority.other;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Priority Breakdown</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-red-500" />
              <span className="font-medium">Very High</span>
            </div>
            <span>{summary.byPriority.veryHigh}</span>
          </div>
          <Progress
            value={total ? (summary.byPriority.veryHigh / total) * 100 : 0}
            className="h-2"
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-orange-500" />
              <span className="font-medium">High</span>
            </div>
            <span>{summary.byPriority.high}</span>
          </div>
          <Progress value={total ? (summary.byPriority.high / total) * 100 : 0} className="h-2" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-yellow-500" />
              <span className="font-medium">Medium</span>
            </div>
            <span>{summary.byPriority.medium}</span>
          </div>
          <Progress value={total ? (summary.byPriority.medium / total) * 100 : 0} className="h-2" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-slate-300" />
              <span className="font-medium">Other</span>
            </div>
            <span>{summary.byPriority.other}</span>
          </div>
          <Progress value={total ? (summary.byPriority.other / total) * 100 : 0} className="h-2" />
        </div>
      </CardContent>
    </Card>
  );
}
