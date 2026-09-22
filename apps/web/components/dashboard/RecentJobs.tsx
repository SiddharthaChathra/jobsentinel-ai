import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { JobCard } from '@/components/jobs/JobCard';
import type { DashboardSummary } from '@/lib/types/jobs';
import Link from 'next/link';

export function RecentJobs({ summary }: { summary: DashboardSummary }) {
  if (!summary.recentJobs || summary.recentJobs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground border border-dashed rounded-lg">
            No recent jobs found.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Recent Jobs</CardTitle>
        <Link href="/jobs" className="text-sm text-primary hover:underline">
          View all
        </Link>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {summary.recentJobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
