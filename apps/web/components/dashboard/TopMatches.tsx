import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { JobCard } from '@/components/jobs/JobCard';
import type { DashboardSummary } from '@/lib/types/jobs';
import Link from 'next/link';

export function TopMatches({ summary }: { summary: DashboardSummary }) {
  if (!summary.topMatches || summary.topMatches.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Top Matches</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground border border-dashed rounded-lg">
            No matches found yet. Keep an eye out!
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Top Matches</CardTitle>
        <Link href="/jobs?sort=score" className="text-sm text-primary hover:underline">
          View all matches
        </Link>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {summary.topMatches.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
