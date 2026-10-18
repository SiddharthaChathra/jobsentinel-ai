'use client';

import { useRef, useState } from 'react';
import type { Resume, ResumeAnalysis } from '@jobsentinel/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApi } from '@/hooks/use-api';
import { ApiError } from '@/lib/api';

type Phase = 'idle' | 'uploading' | 'analyzing' | 'error';
const MAX_MB = 5;

export function ResumeUploadStep({ onAnalyzed }: { onAnalyzed: (a: ResumeAnalysis) => void }) {
  const api = useApi();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!file) return;
    setError(null);
    try {
      setPhase('uploading');
      const form = new FormData();
      form.append('file', file, file.name);
      const { data: resume } = await api.upload<Resume>('/resumes', form);
      setPhase('analyzing');
      const { data: analysis } = await api.post<ResumeAnalysis>(`/resumes/${resume.id}/analyze`);
      await api.post(`/resumes/${resume.id}/activate`);
      onAnalyzed(analysis);
    } catch (err) {
      setPhase('error');
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    }
  }

  const busy = phase === 'uploading' || phase === 'analyzing';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload your resume</CardTitle>
        <CardDescription>
          PDF or DOCX, up to {MAX_MB} MB. Text-based files only (scanned images are not supported
          yet).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label
          htmlFor="resume-file"
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center text-sm hover:bg-muted/50"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const dropped = e.dataTransfer.files[0];
            if (dropped) setFile(dropped);
          }}
        >
          <span className="font-medium">
            {file ? file.name : 'Drop your resume here or tap to choose'}
          </span>
          <span className="text-muted-foreground">
            {file ? `${(file.size / 1024).toFixed(0)} KB` : '.pdf or .docx'}
          </span>
          <input
            id="resume-file"
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="sr-only"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Could not process the resume</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground" role="status">
            {phase === 'uploading' && 'Uploading and reading your resume…'}
            {phase === 'analyzing' && 'Analyzing with AI — this takes a few seconds…'}
          </p>
          <Button data-testid="onboarding-upload" onClick={submit} disabled={!file || busy}>
            {busy ? 'Working…' : 'Upload & analyze'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Your resume is stored privately. Only redacted text (no email, phone or links) is sent to
          the AI provider for analysis.
        </p>
      </CardContent>
    </Card>
  );
}
