'use client';

import Link from 'next/link';
import { ExternalLink, GraduationCap, Briefcase, BookOpen } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { useSkillGaps } from '@/hooks/useSkillGaps';

export default function SkillGapsPage() {
  const { data: report, isLoading, isError } = useSkillGaps();

  return (
    <>
      <PageHeader
        title="Skill gaps"
        description={
          report && report.basedOn > 0
            ? `Based on your top ${report.basedOn} matches`
            : 'Skills frequently requested in your top matching jobs.'
        }
      />

      {isLoading && (
        <div className="space-y-4" aria-busy="true" aria-label="Loading skill gaps">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-xl border border-border/60 bg-muted/40"
            />
          ))}
        </div>
      )}

      {isError && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Could not load skill gaps. Please try again.
        </p>
      )}

      {!isLoading && !isError && report && report.basedOn === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <BookOpen className="size-8 text-muted-foreground" />
          <div>
            <p className="font-medium">
              No matches yet — upload a resume or check back after the next scan.
            </p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Once you have matching jobs, we analyze the most common missing skills across your top
              opportunities.
            </p>
          </div>
          <Link href="/resume" className={buttonVariants({ size: 'sm' })}>
            Go to Resume
          </Link>
        </div>
      )}

      {!isLoading && !isError && report && report.basedOn > 0 && (
        <div className="space-y-4">
          {report.gaps.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
              <GraduationCap className="size-8 text-success" />
              <div>
                <p className="font-medium">Great job! No skill gaps identified.</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                  Your resume matches the core requirements for all of your top {report.basedOn}{' '}
                  jobs.
                </p>
              </div>
            </div>
          )}

          {report.gaps.length > 0 && (
            <div className="space-y-4">
              {report.gaps.map((gap) => {
                const selectorKey = gap.skill.replace(/\s+/g, '-');
                const percent = Math.min(100, Math.round((gap.missingIn / gap.of) * 100));

                return (
                  <Card
                    key={gap.skill}
                    data-testid={`skill-gap-${selectorKey}`}
                    className="overflow-hidden border-border/70 bg-card transition-shadow hover:shadow-xs"
                  >
                    <CardContent className="p-4 sm:p-5 space-y-3.5">
                      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
                        <h2 className="text-base font-semibold tracking-tight text-foreground">
                          {gap.skill} — missing in {gap.missingIn} of {gap.of}
                        </h2>
                        <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                          {percent}% of matches
                        </span>
                      </div>

                      {/* Visual proportion bar */}
                      <div className="h-2 w-full rounded-full bg-muted/60 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-300"
                          style={{ width: `${percent}%` }}
                          role="progressbar"
                          aria-valuenow={gap.missingIn}
                          aria-valuemin={0}
                          aria-valuemax={gap.of}
                          aria-label={`${gap.skill}: missing in ${gap.missingIn} of ${gap.of}`}
                        />
                      </div>

                      {/* Up to 3 example jobs */}
                      {gap.jobs.length > 0 && (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground pt-1">
                          <span className="font-medium inline-flex items-center gap-1 text-foreground/80">
                            <Briefcase className="size-3" />
                            Examples:
                          </span>
                          {gap.jobs.slice(0, 3).map((job, idx) => (
                            <span key={job.id} className="inline-flex items-center">
                              <Link
                                href={`/jobs/${job.id}`}
                                className="font-medium text-primary hover:underline"
                              >
                                {job.title} ({job.company})
                              </Link>
                              {idx < Math.min(gap.jobs.length, 3) - 1 && (
                                <span className="mx-1 text-muted-foreground/50">•</span>
                              )}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Learning links (if approved and present) */}
                      {gap.links && gap.links.length > 0 && (
                        <div
                          data-testid={`skill-gap-links-${selectorKey}`}
                          className="space-y-1.5 pt-2 border-t border-border/40"
                        >
                          <span className="text-xs font-medium text-muted-foreground">
                            Recommended learning:
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {gap.links.map((link) => (
                              <a
                                key={link.url}
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-background/80 px-2.5 py-1 text-xs font-medium text-primary hover:bg-muted hover:text-foreground transition-colors"
                              >
                                <span>{link.title}</span>
                                {link.publisher && (
                                  <span className="text-[11px] text-muted-foreground">
                                    ({link.publisher})
                                  </span>
                                )}
                                <ExternalLink className="size-3 opacity-60 shrink-0" />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Soft skills note (D120): visually lighter, no links, no bars */}
          {report.softSkills && report.softSkills.length > 0 && (
            <div
              data-testid="soft-skills-note"
              className="rounded-xl border border-border/60 bg-muted/30 p-4 sm:p-5 space-y-2 text-sm text-muted-foreground"
            >
              <h3 className="text-sm font-semibold text-foreground">Soft skills</h3>
              <ul className="space-y-1">
                {report.softSkills.map((item) => (
                  <li key={item.skill}>
                    {item.skill} — mentioned in {item.missingIn} of {item.of}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );
}
