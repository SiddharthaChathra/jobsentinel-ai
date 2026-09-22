import type { JobDetail as JobDetailType } from '@/lib/types/jobs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function JobDetail({ job }: { job: JobDetailType }) {
  return (
    <div className="space-y-6">
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
