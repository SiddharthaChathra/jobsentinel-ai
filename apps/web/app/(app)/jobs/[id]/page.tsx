import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { serverApi } from '@/lib/api-server';
import type { JobDetail as JobDetailType } from '@/lib/types/jobs';
import { JobDetail } from '@/components/jobs/JobDetail';
import { TrackerActions } from '@/components/jobs/TrackerActions';
import { MatchBreakdown } from '@/components/jobs/MatchBreakdown';
import { VerificationBadge } from '@/components/jobs/VerificationBadge';
import { Building, MapPin, Banknote, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { RelativeTime } from '@/components/common/RelativeTime';

export const metadata: Metadata = { title: 'Job Details' };

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let job: JobDetailType | null = null;

  try {
    const api = await serverApi();
    const res = await api.get<JobDetailType>(`/jobs/${id}`);
    job = res.data;
  } catch {
    // 404 or network error → fall through to notFound
  }

  if (!job) {
    notFound();
  }

  return (
    // AppShell already renders the page <main> and its padding; a second one nests landmarks.
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header className="space-y-4 pb-4 border-b">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">{job.title}</h1>
            <div className="flex flex-wrap items-center gap-4 text-muted-foreground text-sm">
              <div className="flex items-center gap-1">
                <Building className="h-4 w-4" />
                <span className="font-medium">{job.company.name}</span>
              </div>
              <div className="flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                <span>{job.location.isRemote ? 'Remote' : (job.location.text ?? 'Unknown')}</span>
              </div>
              {job.salary && (
                <div className="flex items-center gap-1">
                  <Banknote className="h-4 w-4" />
                  <span>
                    {job.salary.disclosed && job.salary.text ? job.salary.text : 'Not disclosed'}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                {job.postedAt ? <RelativeTime date={job.postedAt} /> : 'Unknown'}
              </div>
            </div>
          </div>
          <VerificationBadge validation={job.validation} />
        </div>

        <div className="flex flex-wrap gap-2">
          {job.fresherEligible && (
            <Badge className="bg-green-600 hover:bg-green-700">Fresher Eligible</Badge>
          )}
          {job.employmentType !== 'UNKNOWN' && (
            <Badge variant="outline">{job.employmentType.replace('_', ' ')}</Badge>
          )}
          {job.isNew && <Badge className="bg-blue-500 hover:bg-blue-600">New</Badge>}
        </div>
      </header>

      <TrackerActions job={job} />

      <div className="grid gap-6 md:grid-cols-12 items-start">
        <div className="md:col-span-8 space-y-6">
          <JobDetail job={job} />
        </div>
        <div className="md:col-span-4 space-y-6">
          {job.match ? (
            <MatchBreakdown match={job.match} />
          ) : (
            <div className="p-4 border rounded-lg text-center text-sm text-muted-foreground">
              Not scored yet — your resume profile may need updating.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
