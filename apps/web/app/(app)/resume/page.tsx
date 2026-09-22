'use client';

import { useResume, useUploadResume } from '@/hooks/useUser';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, UploadCloud, FileText, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { RelativeTime } from '@/components/common/RelativeTime';

export default function ResumePage() {
  const { data: resume, isLoading } = useResume();
  const uploadMutation = useUploadResume();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      uploadMutation.mutate(e.target.files[0]);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Resume</h1>
        <p className="text-muted-foreground">
          Manage your parsed resume profile and active skills.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Active Resume</CardTitle>
            <CardDescription>Upload a new resume to update your profile.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : resume ? (
              <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
                <div className="flex items-center gap-4">
                  <div className="bg-primary/10 p-3 rounded-full">
                    <FileText className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{resume.fileName}</p>
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

            <div className="relative">
              <input
                type="file"
                accept=".pdf,.doc,.docx"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                onChange={handleFileChange}
                disabled={uploadMutation.isPending}
              />
              <Button className="w-full" disabled={uploadMutation.isPending}>
                {uploadMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <UploadCloud className="mr-2 h-4 w-4" />
                )}
                Upload New Resume
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Profile Details</CardTitle>
            <CardDescription>Extracted from your resume</CardDescription>
          </CardHeader>
          <CardContent>
            {resume && resume.hasAnalysis ? (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium mb-2">Parse Status</h3>
                  <Badge variant="outline">{resume.parseStatus}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {resume.parsedAt ? (
                    <>
                      Parsed <RelativeTime date={resume.parsedAt} />
                    </>
                  ) : (
                    'Not yet parsed'
                  )}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Upload a resume to extract skills and experience.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
