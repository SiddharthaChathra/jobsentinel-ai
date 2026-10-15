import Link from 'next/link';
import {
  AlertTriangle,
  Banknote,
  Building2,
  Clock,
  MapPin,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { JobCard as JobCardType } from '@/lib/types/jobs';
import { RelativeTime } from '@/components/common/RelativeTime';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MatchRing } from './MatchRing';
import { SaveButton } from './SaveButton';

/**
 * One job in a list. The whole card is a link; the Save button stops propagation.
 * Score, verification and fresher-eligibility are the three things worth seeing without opening
 * the job, so they get the visual weight.
 */
export function JobCard({ job }: { job: JobCardType }) {
  const verified = job.validation.companyVerified && job.validation.applicationVerified;
  const suspicious = job.validation.status === 'SUSPICIOUS';
  const unverified = job.validation.status === 'NEEDS_REVIEW';
  const place = job.location.isRemote ? 'Remote' : (job.location.text ?? 'Location not stated');

  return (
    <article
      className={cn(
        'card-hover relative rounded-xl border bg-card p-4 sm:p-5',
        job.isNew ? 'border-primary/40' : 'border-border/60',
      )}
    >
      {job.isNew && (
        <span className="absolute -top-2 left-4 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
          New
        </span>
      )}

      {/* Wraps rather than shrinks: in a narrow column (the Applications board) a `min-w-0` title
          beside the score would be squeezed to nothing and its clamped text would vanish. */}
      <div className="flex flex-wrap items-start gap-3 sm:gap-4">
        <div className="min-w-0 flex-1 basis-40">
          <Link
            href={`/jobs/${job.id}`}
            className="line-clamp-2 text-base font-semibold leading-snug tracking-tight hover:text-primary sm:text-[17px]"
          >
            {job.title}
            <span className="absolute inset-0" aria-hidden />
          </Link>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="size-3.5 shrink-0" />
              <span className="font-medium text-foreground/80">{job.company.name}</span>
              {verified && <ShieldCheck className="size-3.5 text-success" aria-label="Verified" />}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-3.5 shrink-0" />
              {place}
            </span>
            {job.salary && (
              <span className="inline-flex items-center gap-1.5">
                <Banknote className="size-3.5 shrink-0" />
                {job.salary.disclosed && job.salary.text ? job.salary.text : 'Not disclosed'}
              </span>
            )}
          </div>
        </div>

        {job.match ? (
          <MatchRing score={job.match.overallScore} priority={job.match.priority} />
        ) : (
          <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
            Not scored
          </span>
        )}
      </div>

      {job.match && job.match.matchedSkills.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Sparkles className="size-3.5 text-success" aria-hidden />
          {job.match.matchedSkills.slice(0, 5).map((skill) => (
            <span
              key={skill}
              className="rounded-md bg-success/10 px-1.5 py-0.5 text-[11px] font-medium text-success"
            >
              {skill}
            </span>
          ))}
          {job.match.matchedSkills.length > 5 && (
            <span className="text-[11px] text-muted-foreground">
              +{job.match.matchedSkills.length - 5}
            </span>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {job.fresherEligible && (
          <Badge className="border-transparent bg-success/15 text-success hover:bg-success/15">
            Fresher eligible
          </Badge>
        )}
        {job.employmentType !== 'UNKNOWN' && (
          <Badge variant="outline">{job.employmentType.replace(/_/g, ' ').toLowerCase()}</Badge>
        )}
        {suspicious && (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="size-3" />
            Suspicious
          </Badge>
        )}
        {unverified && (
          <Badge variant="secondary" className="gap-1">
            <AlertTriangle className="size-3" />
            Unverified
          </Badge>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="size-3.5" />
          {job.postedAt ? <RelativeTime date={job.postedAt} /> : 'Date unknown'}
        </span>
        {/* Above the card-wide link so both remain clickable. */}
        <div className="relative z-10 flex gap-2">
          <SaveButton jobId={job.id} saved={job.tracker.saved} />
          <Link href={`/jobs/${job.id}`} className={buttonVariants({ size: 'sm' })}>
            View
          </Link>
        </div>
      </div>
    </article>
  );
}
