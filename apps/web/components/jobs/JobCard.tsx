'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Banknote,
  Building2,
  Clock,
  HelpCircle,
  Link2Off,
  MapPin,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { JobCard as JobCardType, HeldInfo, HeldKind, ReviewJobCard } from '@/lib/types/jobs';
import { RelativeTime } from '@/components/common/RelativeTime';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MatchRing } from './MatchRing';
import { SaveButton } from './SaveButton';

const HELD_CONFIG: Record<
  HeldKind,
  {
    tooltip: string;
    icon: typeof AlertTriangle;
    bannerClass: string;
    badgeClass: string;
  }
> = {
  CATEGORY_UNKNOWN: {
    tooltip: "We couldn't tell what kind of work this is from the posting.",
    icon: HelpCircle,
    bannerClass:
      'border-amber-300 bg-amber-50/80 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
    badgeClass:
      'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300 border-amber-300 dark:border-amber-700',
  },
  // Added by Claude with the D110 contract change so main keeps building; Gemini owns the styling.
  EXPERIENCE_UNKNOWN: {
    tooltip: "The posting doesn't say how much experience it needs. Check before applying.",
    icon: HelpCircle,
    bannerClass:
      'border-sky-300 bg-sky-50/80 text-sky-950 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200',
    badgeClass:
      'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-300 border-sky-300 dark:border-sky-700',
  },
  COMPANY_UNVERIFIED: {
    tooltip: "We couldn't confirm the employer. Check the company before applying.",
    icon: ShieldAlert,
    bannerClass:
      'border-orange-300 bg-orange-50/80 text-orange-950 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-200',
    badgeClass:
      'bg-orange-100 text-orange-800 dark:bg-orange-900/60 dark:text-orange-300 border-orange-300 dark:border-orange-700',
  },
  URL_UNREACHABLE: {
    tooltip: "The application page didn't open when we checked.",
    icon: Link2Off,
    bannerClass:
      'border-rose-300 bg-rose-50/80 text-rose-950 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200',
    badgeClass:
      'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-300 border-rose-300 dark:border-rose-700',
  },
  OTHER: {
    tooltip: '',
    icon: AlertTriangle,
    bannerClass:
      'border-purple-300 bg-purple-50/80 text-purple-950 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-200',
    badgeClass:
      'bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-300 border-purple-300 dark:border-purple-700',
  },
};

export interface JobCardProps {
  job: JobCardType | ReviewJobCard;
  held?: HeldInfo;
}

/**
 * One job in a list. The whole card is a link; the Save and Apply buttons stop propagation.
 * When `held` is provided (or job is a ReviewJobCard), renders a top "Held" banner with
 * kind icon/tooltip, and provides a caution step before opening application URL.
 */
export function JobCard({ job, held: propHeld }: JobCardProps) {
  const held = propHeld ?? ('held' in job ? (job as ReviewJobCard).held : undefined);
  const [cautionOpen, setCautionOpen] = useState(false);

  const verified = job.validation.companyVerified && job.validation.applicationVerified;
  const suspicious = job.validation.status === 'SUSPICIOUS';
  const unverified = job.validation.status === 'NEEDS_REVIEW';
  const place = job.location.isRemote ? 'Remote' : (job.location.text ?? 'Location not stated');

  const isKnownKind = held && held.kind in HELD_CONFIG;
  const effectiveKind = isKnownKind ? held.kind : 'OTHER';
  const heldCfg = held ? (HELD_CONFIG[effectiveKind] ?? HELD_CONFIG.OTHER) : undefined;
  const heldTooltip = held
    ? effectiveKind === 'OTHER'
      ? held.reason
      : (heldCfg?.tooltip ?? held.reason)
    : '';
  const HeldIcon = heldCfg?.icon ?? AlertTriangle;

  const handleOpenCaution = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setCautionOpen(true);
  };

  const handleConfirmApply = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setCautionOpen(false);
    window.open(job.applicationUrl, '_blank', 'noopener,noreferrer');
  };

  const handleCancelCaution = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setCautionOpen(false);
  };

  return (
    <article
      data-testid={`job-card-${job.id}`}
      className={cn(
        'card-hover relative rounded-xl border bg-card p-4 sm:p-5',
        job.isNew ? 'border-primary/40' : 'border-border/60',
        // Clip only held cards (their banner is full-bleed): the "New" pill sits above the edge.
        held ? 'overflow-hidden border-amber-300/60 dark:border-amber-700/60' : '',
      )}
    >
      {/* Held banner (C step 2, D106) */}
      {held && (
        <div
          data-testid={`held-banner-${job.id}`}
          className={cn(
            'mb-3.5 -mx-4 -mt-4 sm:-mx-5 sm:-mt-5 flex items-center justify-between gap-2 border-b px-4 py-2.5 text-xs',
            heldCfg?.bannerClass,
          )}
          title={heldTooltip}
          aria-label={`Held for review: ${held.label}`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <HeldIcon className="size-4 shrink-0" aria-label={effectiveKind} />
            <span className="font-medium truncate">{held.label}</span>
          </div>
          <span
            data-testid={`held-kind-${job.id}`}
            className={cn(
              'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
              heldCfg?.badgeClass,
            )}
            title={heldTooltip}
          >
            {effectiveKind}
          </span>
        </div>
      )}

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
            data-testid={`job-card-title-${job.id}`}
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
            <span className="inline-flex items-center gap-1.5">
              <Banknote className="size-3.5 shrink-0" />
              {job.salary?.disclosed && job.salary?.text ? job.salary.text : 'Not disclosed'}
            </span>
          </div>
        </div>

        {job.match ? (
          <div className="flex flex-col items-center">
            <MatchRing score={job.match.overallScore} priority={job.match.priority} />
            {job.match.scoring === 'RULES_ONLY' && (
              <span
                data-testid={`scoring-rules-only-${job.id}`}
                className="mt-1 text-[10px] text-muted-foreground cursor-help"
                title="The AI budget was used up or the AI was unavailable; this score comes from the rules. It may be refined later."
              >
                Rules-only score
              </span>
            )}
          </div>
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
        {job.postingType === 'CAMPUS_DRIVE' && (
          <Badge
            variant="secondary"
            data-testid={`posting-type-${job.id}`}
            className="border-indigo-200 bg-indigo-100 text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300"
          >
            Campus drive
          </Badge>
        )}
        {job.postingType === 'OFF_CAMPUS_PROGRAM' && (
          <Badge
            variant="secondary"
            data-testid={`posting-type-${job.id}`}
            className="border-purple-200 bg-purple-100 text-purple-800 dark:border-purple-800 dark:bg-purple-950/60 dark:text-purple-300"
          >
            Off-campus programme
          </Badge>
        )}
        {job.company.hiresFreshersOften && (
          <Badge
            variant="secondary"
            data-testid={`fresher-badge-${job.id}`}
            title="This company often posts roles open to freshers. Shown for information only; it never hides or ranks jobs."
            className="border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
          >
            Hires freshers often
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
        {unverified && !held && (
          <Badge variant="secondary" className="gap-1">
            <AlertTriangle className="size-3" />
            Unverified
          </Badge>
        )}
      </div>

      {/* Caution prompt when unverified job apply is clicked */}
      {cautionOpen && (
        <div
          role="alertdialog"
          aria-label="Caution: unverified job"
          className="relative z-10 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-400 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <span className="font-medium">This job isn&apos;t verified. Open anyway?</span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="default"
              data-testid="apply-caution-confirm"
              onClick={handleConfirmApply}
            >
              Open anyway
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={handleCancelCaution}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3.5" />
            {job.postedAt ? <RelativeTime date={job.postedAt} /> : 'Date unknown'}
          </span>
          {job.attribution && (
            <a
              href={job.attribution.url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid={`attribution-${job.id}`}
              onClick={(e) => e.stopPropagation()}
              className="relative z-10 inline-flex min-h-[23px] min-w-[116px] items-center justify-center rounded-md border border-border/80 bg-background/80 px-2.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              style={{ minWidth: 116, minHeight: 23 }}
              aria-label={`Jobs by ${job.attribution.label}`}
            >
              Jobs by{' '}
              <span className="ml-1 font-semibold text-primary underline">
                {job.attribution.label}
              </span>
            </a>
          )}
        </div>
        {/* Above the card-wide link so both remain clickable. */}
        <div className="relative z-10 flex items-center gap-2">
          <SaveButton jobId={job.id} saved={job.tracker.saved} />
          {held && !cautionOpen && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleOpenCaution}
              aria-label={`Apply to ${job.title}`}
            >
              Apply
            </Button>
          )}
          <Link href={`/jobs/${job.id}`} className={buttonVariants({ size: 'sm' })}>
            View
          </Link>
        </div>
      </div>
    </article>
  );
}
