'use client';

import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import type { JobCategory, PreferencesInput, RemotePreference } from '@jobsentinel/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { usePreferences, useUpdatePreferences } from '@/hooks/useUser';
import { cn } from '@/lib/utils';

const CATEGORIES: { value: JobCategory; label: string }[] = [
  { value: 'SOFTWARE', label: 'Software' },
  { value: 'IT_SUPPORT', label: 'IT support' },
  { value: 'NETWORK', label: 'Networking' },
  { value: 'CLOUD_DEVOPS', label: 'Cloud / DevOps' },
  { value: 'DATA', label: 'Data' },
  { value: 'ELECTRICAL_ELECTRONICS', label: 'Electrical / Electronics' },
  { value: 'MECHANICAL', label: 'Mechanical' },
  { value: 'CIVIL', label: 'Civil' },
  { value: 'OTHER_ENGINEERING', label: 'Other engineering' },
];

const REMOTE: { value: RemotePreference; label: string }[] = [
  { value: 'ANY', label: 'Anything' },
  { value: 'REMOTE_ONLY', label: 'Remote only' },
  { value: 'HYBRID_OK', label: 'Hybrid is fine' },
  { value: 'ONSITE_ONLY', label: 'On-site only' },
];

/**
 * The settings that decide which jobs are scanned for and how they score. Categories in
 * particular are the gate: a category nobody monitors is filtered out before it is ever scored.
 */
export default function PreferencesPage() {
  const { data, isLoading } = usePreferences();
  const update = useUpdatePreferences();
  const [form, setForm] = useState<PreferencesInput | null>(null);
  const [locationDraft, setLocationDraft] = useState('');
  const [lastSynced, setLastSynced] = useState(data);

  // Adopt the server's copy whenever it changes. Done during render rather than in an effect, so
  // the form never paints one frame of stale values.
  if (data && data !== lastSynced) {
    setLastSynced(data);
    setForm({ ...data });
  }

  if (isLoading || !form) {
    return (
      <>
        <PageHeader title="Preferences" description="What you are looking for." />
        <div className="h-96 animate-pulse rounded-xl border border-border/60 bg-muted/40" />
      </>
    );
  }

  const toggleCategory = (value: JobCategory) => {
    const has = form.categories.includes(value);
    // At least one category must stay on, or nothing would ever be scanned for.
    if (has && form.categories.length === 1) return;
    setForm({
      ...form,
      categories: has ? form.categories.filter((c) => c !== value) : [...form.categories, value],
    });
  };

  const addLocation = () => {
    const value = locationDraft.trim();
    if (!value || form.locations.includes(value)) return;
    setForm({ ...form, locations: [...form.locations, value] });
    setLocationDraft('');
  };

  return (
    <>
      <PageHeader
        title="Preferences"
        description="These decide which jobs are collected and how they are scored."
      />

      <div className="grid max-w-3xl gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Locations</CardTitle>
            <CardDescription>
              Cities or countries you would work in. A country matches every city in it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {form.locations.map((loc) => (
                <span
                  key={loc}
                  className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-sm"
                >
                  {loc}
                  <button
                    type="button"
                    aria-label={`Remove ${loc}`}
                    onClick={() =>
                      setForm({ ...form, locations: form.locations.filter((l) => l !== loc) })
                    }
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              ))}
              {form.locations.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No locations set — every location scores the same.
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                value={locationDraft}
                placeholder="e.g. Bengaluru, Remote, India"
                onChange={(e) => setLocationDraft(e.target.value)}
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Categories</CardTitle>
            <CardDescription>
              Only these are collected. A job outside them is filtered out before scoring.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => {
                const on = form.categories.includes(c.value);
                return (
                  <button
                    key={c.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleCategory(c.value)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-sm transition-colors',
                      on
                        ? 'border-primary/40 bg-primary/10 font-medium text-primary'
                        : 'border-border text-muted-foreground hover:bg-accent',
                    )}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Work style and level</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-1.5">
              <Label>Remote preference</Label>
              <div className="flex flex-wrap gap-2">
                {REMOTE.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    aria-pressed={form.remotePreference === r.value}
                    onClick={() => setForm({ ...form, remotePreference: r.value })}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-sm transition-colors',
                      form.remotePreference === r.value
                        ? 'border-primary/40 bg-primary/10 font-medium text-primary'
                        : 'border-border text-muted-foreground hover:bg-accent',
                    )}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Fresher roles only</p>
                <p className="text-xs text-muted-foreground">
                  Filters out anything that states an experience requirement you cannot meet.
                </p>
              </div>
              <Switch
                checked={form.fresherOnly}
                onCheckedChange={(on) => setForm({ ...form, fresherOnly: on })}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Keep jobs with no stated experience</p>
                <p className="text-xs text-muted-foreground">
                  Many good postings simply do not say. Turning this off hides them.
                </p>
              </div>
              <Switch
                checked={form.includeUnknownExperience}
                onCheckedChange={(on) => setForm({ ...form, includeUnknownExperience: on })}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="graduationYear">Graduation year</Label>
                <Input
                  id="graduationYear"
                  type="number"
                  min={2000}
                  max={2040}
                  value={form.graduationYear ?? ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      graduationYear: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="salaryMin">Minimum salary (optional)</Label>
                <Input
                  id="salaryMin"
                  type="number"
                  min={0}
                  placeholder="e.g. 500000"
                  value={form.salaryMin ?? ''}
                  onChange={(e) =>
                    setForm({ ...form, salaryMin: e.target.value ? Number(e.target.value) : null })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Most postings never state pay, so this hides more than you would expect.
                </p>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex items-center gap-3 border-t border-border/60 pt-4">
            <Button onClick={() => update.mutate(form)} disabled={update.isPending}>
              {update.isPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Save preferences
            </Button>
            {update.isSuccess && (
              <span className="text-sm text-success">
                Saved — jobs will be re-scored on the next run.
              </span>
            )}
            {update.isError && <span className="text-sm text-destructive">Could not save.</span>}
          </CardFooter>
        </Card>
      </div>
    </>
  );
}
