'use client';

import { useState, type FormEvent } from 'react';
import {
  ExperienceLevel,
  type ProfileInput,
  type ProfileSkillInput,
  type ResumeAnalysis,
  type SkillCategory,
} from '@jobsentinel/types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useApi } from '@/hooks/use-api';
import { ApiError } from '@/lib/api';

interface Props {
  analysis: ResumeAnalysis;
  onBack: () => void;
  onSaved: () => void;
}

const LEVEL_LABELS: Record<ExperienceLevel, string> = {
  FRESHER: 'Fresher (no full-time experience)',
  ENTRY_LEVEL: 'Entry level (< 2 years)',
  EXPERIENCED: 'Experienced',
  UNKNOWN: 'Not sure',
};

/** The AI suggests, the user decides (docs 05 §1 of the spec). Every field here is editable. */
export function ProfileReviewStep({ analysis, onBack, onSaved }: Props) {
  const api = useApi();
  const d = analysis.draft;
  const [level, setLevel] = useState<ExperienceLevel>(d.experienceLevel);
  const [graduationYear, setGraduationYear] = useState(d.graduationYear?.toString() ?? '');
  const [degree, setDegree] = useState(d.degree ?? '');
  const [branch, setBranch] = useState(d.branch ?? '');
  const [college, setCollege] = useState(d.college ?? '');
  const [location, setLocation] = useState(d.location ?? '');
  const [summary, setSummary] = useState(d.summary ?? '');
  const [skills, setSkills] = useState<ProfileSkillInput[]>(d.skills);
  const [newSkill, setNewSkill] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addSkill() {
    const name = newSkill.trim();
    if (!name || skills.some((s) => s.name.toLowerCase() === name.toLowerCase()))
      return setNewSkill('');
    setSkills([...skills, { name, category: 'OTHER' as SkillCategory, proficiency: null }]);
    setNewSkill('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (skills.length === 0) return setError('Add at least one skill.');
    setSaving(true);
    setError(null);
    const body: ProfileInput = {
      sourceResumeId: analysis.resumeId,
      experienceLevel: level,
      graduationYear: graduationYear ? Number(graduationYear) : null,
      degree: degree || null,
      branch: branch || null,
      college: college || null,
      locationText: location || null,
      summary: summary || null,
      education: d.education,
      projects: d.projects,
      experience: d.experience,
      certifications: d.certifications,
      skills,
    };
    try {
      await api.put('/profile', body);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the profile.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Card>
        <CardHeader>
          <CardTitle>Check what we found</CardTitle>
          <CardDescription>
            {analysis.deterministicFallback
              ? 'AI analysis was unavailable, so this draft comes from keyword extraction — please review it carefully.'
              : `Suggested by ${analysis.provider} (${analysis.model}). Edit anything that is wrong.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Experience level</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {ExperienceLevel.options.map((opt) => (
                <label
                  key={opt}
                  className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm has-[:checked]:border-primary"
                >
                  <input
                    type="radio"
                    name="level"
                    value={opt}
                    checked={level === opt}
                    onChange={() => setLevel(opt)}
                  />
                  {LEVEL_LABELS[opt]}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="grad"
              label="Graduation year"
              value={graduationYear}
              onChange={setGraduationYear}
              type="number"
              placeholder="2027"
            />
            <Field
              id="degree"
              label="Degree"
              value={degree}
              onChange={setDegree}
              placeholder="B.E. / B.Tech"
            />
            <Field
              id="branch"
              label="Branch"
              value={branch}
              onChange={setBranch}
              placeholder="Computer Science"
            />
            <Field id="college" label="College" value={college} onChange={setCollege} />
            <Field
              id="location"
              label="Home location"
              value={location}
              onChange={setLocation}
              placeholder="Bengaluru, India"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="summary">Summary</Label>
            <Textarea
              id="summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
              maxLength={600}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-skill">Skills ({skills.length})</Label>
            <ul className="flex flex-wrap gap-2" aria-label="Skills">
              {skills.map((s) => (
                <li key={s.name}>
                  <Badge variant="secondary" className="gap-1 pr-1">
                    {s.name}
                    <button
                      type="button"
                      aria-label={`Remove ${s.name}`}
                      className="rounded px-1 hover:bg-muted"
                      onClick={() => setSkills(skills.filter((x) => x.name !== s.name))}
                    >
                      ×
                    </button>
                  </Badge>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Input
                id="new-skill"
                value={newSkill}
                placeholder="Add a skill and press Enter"
                onChange={(e) => setNewSkill(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addSkill();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addSkill}>
                Add
              </Button>
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex justify-between">
            <Button type="button" variant="ghost" onClick={onBack}>
              Back
            </Button>
            <Button type="submit" data-testid="onboarding-confirm-profile" disabled={saving}>
              {saving ? 'Saving…' : 'Confirm profile'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}

function Field(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        type={props.type ?? 'text'}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}
