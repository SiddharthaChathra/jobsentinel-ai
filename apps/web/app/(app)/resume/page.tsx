'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ExperienceLevel, ResumeAnalysis } from '@jobsentinel/types';
import { useProfile, useResume } from '@/hooks/useUser';
import { queryKeys } from '@/lib/queryKeys';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, UploadCloud, FileText, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { RelativeTime } from '@/components/common/RelativeTime';
import { ResumeUploadStep } from '@/components/onboarding/resume-upload-step';
import { ProfileReviewStep } from '@/components/onboarding/profile-review-step';

const LEVEL_LABELS: Record<ExperienceLevel, string> = {
  FRESHER: 'Fresher',
  ENTRY_LEVEL: 'Entry level (< 2 years)',
  EXPERIENCED: 'Experienced',
  UNKNOWN: 'Not stated',
};

type Mode = 'view' | 'upload' | 'review';

/**
 * A new resume only produces a *suggested* profile; matching uses the profile the user confirms
 * (`PUT /profile`, which bumps the version and re-scores). Replacing a resume therefore goes through
 * the same upload → review steps as onboarding — uploading alone would leave matching on the old
 * profile while the page claimed it had been updated.
 */
export default function ResumePage() {
  const qc = useQueryClient();
  const { data: resume, isLoading } = useResume();
  const { data: profile, isLoading: profileLoading } = useProfile();
  const [mode, setMode] = useState<Mode>('view');
  const [analysis, setAnalysis] = useState<ResumeAnalysis | null>(null);

  function onProfileSaved() {
    void qc.invalidateQueries({ queryKey: queryKeys.user.all });
    void qc.invalidateQueries({ queryKey: queryKeys.jobs.all });
    void qc.invalidateQueries({ queryKey: queryKeys.dashboard.summary });
    setAnalysis(null);
    setMode('view');
  }

  if (mode === 'upload') {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <ResumeUploadStep
          onAnalyzed={(a) => {
            setAnalysis(a);
            setMode('review');
          }}
        />
        <Button variant="ghost" onClick={() => setMode('view')}>
          Cancel
        </Button>
      </div>
    );
  }

  if (mode === 'review' && analysis) {
    return (
      <div className="mx-auto max-w-3xl">
        <ProfileReviewStep
          analysis={analysis}
          onBack={() => setMode('upload')}
          onSaved={onProfileSaved}
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Resume</h1>
        <p className="text-muted-foreground">
          Your resume and the profile your matches are scored against.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Active Resume</CardTitle>
            <CardDescription>
              Upload a new resume, then confirm what we found to update your profile.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : resume ? (
              <div className="flex items-center justify-between gap-3 p-4 border rounded-lg bg-muted/50">
                <div className="flex min-w-0 items-center gap-4">
                  <div className="bg-primary/10 p-3 rounded-full">
                    <FileText className="h-6 w-6 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{resume.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      Uploaded <RelativeTime date={resume.uploadedAt} />
                    </p>
                  </div>
                </div>
                <Badge variant="secondary" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {resume.parseStatus}
                </Badge>
              </div>
            ) : (
              <div className="text-center p-8 border border-dashed rounded-lg">
                <p className="text-muted-foreground mb-4">No resume uploaded</p>
              </div>
            )}

            <Button className="w-full" onClick={() => setMode('upload')}>
              <UploadCloud className="mr-2 h-4 w-4" />
              Upload New Resume
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Profile Details</CardTitle>
            <CardDescription>Confirmed by you — this is what matching uses.</CardDescription>
          </CardHeader>
          <CardContent>
            {profileLoading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : profile ? (
              <div className="space-y-4 text-sm">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                  <dt className="text-muted-foreground">Level</dt>
                  <dd>{LEVEL_LABELS[profile.experienceLevel]}</dd>
                  <dt className="text-muted-foreground">Graduation</dt>
                  <dd>{profile.graduationYear ?? '—'}</dd>
                  <dt className="text-muted-foreground">Education</dt>
                  <dd>
                    {[profile.degree, profile.branch, profile.college].filter(Boolean).join(', ') ||
                      '—'}
                  </dd>
                </dl>
                <div>
                  <h3 className="mb-2 font-medium">Skills ({profile.skills.length})</h3>
                  <ul className="flex flex-wrap gap-1.5" aria-label="Skills">
                    {profile.skills.map((s) => (
                      <li key={s.id}>
                        <Badge variant="outline">{s.name}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
                {profile.confirmedAt && (
                  <p className="text-xs text-muted-foreground">
                    Confirmed <RelativeTime date={profile.confirmedAt} />
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Upload a resume and confirm what we found to build your profile.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
