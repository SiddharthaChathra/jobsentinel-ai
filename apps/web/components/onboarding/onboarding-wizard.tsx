'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ResumeAnalysis } from '@jobsentinel/types';
import { Progress } from '@/components/ui/progress';
import { PreferencesStep } from './preferences-step';
import { ProfileReviewStep } from './profile-review-step';
import { ResumeUploadStep } from './resume-upload-step';

type Step = 'upload' | 'review' | 'preferences';
const STEPS: { key: Step; label: string }[] = [
  { key: 'upload', label: 'Resume' },
  { key: 'review', label: 'Profile' },
  { key: 'preferences', label: 'Preferences' },
];

/**
 * Three-step onboarding (docs 01 §4.1): upload → AI-suggested profile the user edits → preferences.
 * Phase 2 scaffold owned by Claude; visual polish and mobile UX belong to Gemini (Phases 8/11).
 */
export function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('upload');
  const [analysis, setAnalysis] = useState<ResumeAnalysis | null>(null);
  const index = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="space-y-6">
      <div>
        <ol className="mb-2 flex justify-between text-xs font-medium text-muted-foreground">
          {STEPS.map((s, i) => (
            <li
              key={s.key}
              className={i <= index ? 'text-foreground' : undefined}
              aria-current={s.key === step ? 'step' : undefined}
            >
              {i + 1}. {s.label}
            </li>
          ))}
        </ol>
        <Progress
          value={((index + 1) / STEPS.length) * 100}
          aria-label={`Step ${index + 1} of ${STEPS.length}`}
        />
      </div>

      {step === 'upload' && (
        <ResumeUploadStep
          onAnalyzed={(a) => {
            setAnalysis(a);
            setStep('review');
          }}
        />
      )}
      {step === 'review' && analysis && (
        <ProfileReviewStep
          analysis={analysis}
          onBack={() => setStep('upload')}
          onSaved={() => setStep('preferences')}
        />
      )}
      {step === 'preferences' && analysis && (
        <PreferencesStep
          suggestedRoles={analysis.draft.suggestedRoles}
          suggestedLocations={analysis.draft.suggestedLocations}
          graduationYear={analysis.draft.graduationYear}
          onBack={() => setStep('review')}
          onDone={() => {
            router.replace('/dashboard');
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
