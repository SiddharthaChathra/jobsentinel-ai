import type { JobDetail as JobDetailType } from '@/lib/types/jobs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function JobDetail({ job }: { job: JobDetailType }) {
  return (
    <div className="space-y-6">
      {/* Overview: salary, posting type, and attribution */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-muted-foreground">Salary:</span>
              <span
                data-testid={`detail-salary-${job.id}`}
                className="font-semibold text-foreground"
              >
                {job.salary?.disclosed && job.salary?.text ? job.salary.text : 'Not disclosed'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
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
              {job.attribution && (
                <a
                  href={job.attribution.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid={`attribution-${job.id}`}
                  className="inline-flex min-h-[23px] min-w-[116px] items-center justify-center rounded-md border border-border/80 bg-background/80 px-2.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Job Description</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm whitespace-pre-wrap break-words">{job.description}</div>
        </CardContent>
      </Card>

      {job.requirements && job.requirements.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Requirements</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc pl-5 space-y-2">
              {job.requirements.map((req, i) => (
                <li key={i} className="text-sm">
                  {req}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Validation evidence — always shown alongside any confidence number */}
      <Card>
        <CardHeader>
          <CardTitle>Verification Evidence</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant={job.validationDetail.status === 'VALID' ? 'default' : 'secondary'}>
              {job.validationDetail.status}
            </Badge>
            {job.validationDetail.confidence !== null && (
              <span className="text-muted-foreground">
                Confidence: {Math.round(job.validationDetail.confidence * 100)}%
              </span>
            )}
          </div>
          {job.validationDetail.evidence.length > 0 && (
            <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
              {job.validationDetail.evidence.map((ev, i) => (
                <li key={i}>
                  <span className="font-medium">{ev.code}</span>
                  {ev.detail && ` — ${ev.detail}`}
                  <span className="ml-1 text-xs">
                    ({ev.weight > 0 ? '+' : ''}
                    {ev.weight})
                  </span>
                </li>
              ))}
            </ul>
          )}
          {job.validationDetail.suspiciousFlags.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-destructive mb-1">Suspicious Flags</h4>
              <ul className="list-disc pl-5 space-y-1 text-sm text-destructive/80">
                {job.validationDetail.suspiciousFlags.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {job.sources && job.sources.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Sources</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {job.sources.map((s, i) => (
                <li key={i} className="text-sm flex items-center justify-between">
                  <span>{s.name}</span>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    View original
                  </a>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
