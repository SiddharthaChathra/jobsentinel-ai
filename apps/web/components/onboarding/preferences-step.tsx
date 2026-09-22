'use client';

import { useState, type FormEvent } from 'react';
import {
  EmploymentType,
  JobCategory,
  RemotePreference,
  type PreferencesInput,
  type PreferredRoleInput,
  type ResumeProfileDraft,
  type RoleTier,
} from '@jobsentinel/types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApi } from '@/hooks/use-api';
import { ApiError } from '@/lib/api';

interface Props {
  suggestedRoles: ResumeProfileDraft['suggestedRoles'];
  suggestedLocations: string[];
  graduationYear: number | null;
  onBack: () => void;
  onDone: () => void;
}

const CATEGORY_LABELS: Record<JobCategory, string> = {
  SOFTWARE: 'Software / SDE',
  IT_SUPPORT: 'IT & Technical Support',
  NETWORK: 'Network & Security',
  CLOUD_DEVOPS: 'Cloud & DevOps',
  DATA: 'Data & Analytics',
  ELECTRICAL_ELECTRONICS: 'Electrical / Electronics',
  MECHANICAL: 'Mechanical',
  CIVIL: 'Civil',
  OTHER_ENGINEERING: 'Other engineering',
  NON_ENGINEERING: 'Non-engineering',
  UNKNOWN: 'Unclassified',
};
const EMPLOYMENT_LABELS: Record<EmploymentType, string> = {
  FULL_TIME: 'Full-time',
  INTERNSHIP: 'Internship',
  TRAINEE: 'Trainee / GET',
  CONTRACT: 'Contract',
  PART_TIME: 'Part-time',
  UNKNOWN: 'Unspecified',
};
const REMOTE_LABELS: Record<RemotePreference, string> = {
  ANY: 'Any',
  REMOTE_ONLY: 'Remote only',
  ONSITE_ONLY: 'On-site only',
  HYBRID_OK: 'Hybrid or on-site',
};
const DEFAULT_ROLES: PreferredRoleInput[] = [
  { title: 'Software Engineer', tier: 'PRIMARY', enabled: true },
  { title: 'SDE', tier: 'PRIMARY', enabled: true },
  { title: 'Technical Support Engineer', tier: 'PRIMARY', enabled: true },
  { title: 'Network Engineer', tier: 'PRIMARY', enabled: true },
  { title: 'Cloud Engineer', tier: 'SECONDARY', enabled: true },
  { title: 'Data Engineer', tier: 'SECONDARY', enabled: true },
  { title: 'Data Analyst', tier: 'SECONDARY', enabled: true },
];

export function PreferencesStep({
  suggestedRoles,
  suggestedLocations,
  graduationYear,
  onBack,
  onDone,
}: Props) {
  const api = useApi();
  const [roles, setRoles] = useState<PreferredRoleInput[]>(
    suggestedRoles.length > 0
      ? suggestedRoles.map((r) => ({ title: r.title, tier: r.tier, enabled: true }))
      : DEFAULT_ROLES,
  );
  const [newRole, setNewRole] = useState('');
  const [locations, setLocations] = useState<string[]>(
    suggestedLocations.length > 0
      ? [...new Set([...suggestedLocations, 'India', 'Remote'])]
      : ['India', 'Remote'],
  );
  const [newLocation, setNewLocation] = useState('');
  const [remote, setRemote] = useState<RemotePreference>('ANY');
  const [employment, setEmployment] = useState<EmploymentType[]>([
    'FULL_TIME',
    'INTERNSHIP',
    'TRAINEE',
  ]);
  const [categories, setCategories] = useState<JobCategory[]>([
    'SOFTWARE',
    'IT_SUPPORT',
    'NETWORK',
    'CLOUD_DEVOPS',
    'DATA',
  ]);
  const [fresherOnly, setFresherOnly] = useState(true);
  const [instantMinScore, setInstantMinScore] = useState(75);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = <T,>(list: T[], v: T, set: (l: T[]) => void) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  function addRole() {
    const title = newRole.trim();
    if (title && !roles.some((r) => r.title.toLowerCase() === title.toLowerCase()))
      setRoles([...roles, { title, tier: 'OTHER', enabled: true }]);
    setNewRole('');
  }
  function addLocation() {
    const loc = newLocation.trim();
    if (loc && !locations.some((l) => l.toLowerCase() === loc.toLowerCase()))
      setLocations([...locations, loc]);
    setNewLocation('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (roles.length === 0) return setError('Add at least one role to look for.');
    if (categories.length === 0) return setError('Select at least one category.');
    setSaving(true);
    setError(null);
    const prefs: PreferencesInput = {
      locations,
      remotePreference: remote,
      employmentTypes: employment,
      categories,
      fresherOnly,
      includeUnknownExperience: true,
      salaryMin: null,
      salaryCurrency: 'INR',
      graduationYear,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
      instantMinScore,
    };
    try {
      await api.put('/preferred-roles', roles);
      await api.put('/preferences', prefs);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save preferences.');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Card>
        <CardHeader>
          <CardTitle>What should we look for?</CardTitle>
          <CardDescription>
            Primary roles are prioritized; other categories are still monitored and shown
            separately.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <section className="space-y-2">
            <Label htmlFor="new-role">Target roles</Label>
            <ul className="space-y-2">
              {roles.map((r) => (
                <li key={r.title} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                  <span className="flex-1">{r.title}</span>
                  <select
                    aria-label={`Priority for ${r.title}`}
                    className="rounded-md border bg-background px-2 py-1 text-xs"
                    value={r.tier}
                    onChange={(e) =>
                      setRoles(
                        roles.map((x) =>
                          x.title === r.title ? { ...x, tier: e.target.value as RoleTier } : x,
                        ),
                      )
                    }
                  >
                    <option value="PRIMARY">Primary</option>
                    <option value="SECONDARY">Secondary</option>
                    <option value="OTHER">Other</option>
                  </select>
                  <button
                    type="button"
                    aria-label={`Remove ${r.title}`}
                    className="px-1 text-muted-foreground hover:text-foreground"
                    onClick={() => setRoles(roles.filter((x) => x.title !== r.title))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Input
                id="new-role"
                value={newRole}
                placeholder="Add a role, e.g. QA Engineer"
                onChange={(e) => setNewRole(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addRole();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addRole}>
                Add
              </Button>
            </div>
          </section>

          <section className="space-y-2">
            <Label>Categories to monitor</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {JobCategory.options
                .filter((c) => c !== 'UNKNOWN')
                .map((c) => (
                  <label key={c} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={categories.includes(c)}
                      onChange={() => toggle(categories, c, setCategories)}
                    />
                    {CATEGORY_LABELS[c]}
                  </label>
                ))}
            </div>
          </section>

          <section className="space-y-2">
            <Label htmlFor="new-location">Locations</Label>
            <ul className="flex flex-wrap gap-2">
              {locations.map((l) => (
                <li
                  key={l}
                  className="flex items-center gap-1 rounded-full border px-3 py-1 text-sm"
                >
                  {l}
                  <button
                    type="button"
                    aria-label={`Remove ${l}`}
                    onClick={() => setLocations(locations.filter((x) => x !== l))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Input
                id="new-location"
                value={newLocation}
                placeholder="City or country"
                onChange={(e) => setNewLocation(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addLocation();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addLocation}>
                Add
              </Button>
            </div>
            <div className="flex flex-wrap gap-3 pt-1">
              {RemotePreference.options.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="remote"
                    checked={remote === r}
                    onChange={() => setRemote(r)}
                  />
                  {REMOTE_LABELS[r]}
                </label>
              ))}
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Job types</Label>
              {EmploymentType.options
                .filter((t) => t !== 'UNKNOWN')
                .map((t) => (
                  <label key={t} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={employment.includes(t)}
                      onChange={() => toggle(employment, t, setEmployment)}
                    />
                    {EMPLOYMENT_LABELS[t]}
                  </label>
                ))}
            </div>
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={fresherOnly}
                  onChange={(e) => setFresherOnly(e.target.checked)}
                />
                Fresher / entry-level only
              </label>
              <div className="space-y-1">
                <Label htmlFor="threshold">Instant alert threshold: {instantMinScore}% match</Label>
                <input
                  id="threshold"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={instantMinScore}
                  onChange={(e) => setInstantMinScore(Number(e.target.value))}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  Jobs below this still appear in the daily digest and dashboard.
                </p>
              </div>
            </div>
          </section>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex justify-between">
            <Button type="button" variant="ghost" onClick={onBack}>
              Back
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Start monitoring'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
