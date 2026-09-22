import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Briefcase, AlertCircle, Bookmark, CheckCircle2 } from 'lucide-react';
import type { DashboardSummary } from '@/lib/types/jobs';

export function StatTiles({ summary }: { summary: DashboardSummary }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">New Today</CardTitle>
          <Briefcase className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{summary.newToday}</div>
          <p className="text-xs text-muted-foreground">+{summary.newThisWeek} this week</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Needs Review</CardTitle>
          <AlertCircle className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{summary.needsReview}</div>
          <p className="text-xs text-muted-foreground">Jobs flagged for manual check</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Saved Jobs</CardTitle>
          <Bookmark className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{summary.saved}</div>
          <p className="text-xs text-muted-foreground">Opportunities you are tracking</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Applications</CardTitle>
          <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{summary.applications.applied}</div>
          <p className="text-xs text-muted-foreground">
            {summary.applications.interview} interviews, {summary.applications.selected} selected
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
