'use client';

import { usePreferences, useUpdatePreferences } from '@/hooks/useUser';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useState } from 'react';
import type { PreferencesInput } from '@/lib/types/user';

export default function PreferencesPage() {
  const { data: prefs, isLoading } = usePreferences();
  const updateMutation = useUpdatePreferences();

  const [localPrefs, setLocalPrefs] = useState<Partial<PreferencesInput>>({});
  const [initialised, setInitialised] = useState(false);

  // Initialise local state from server data once.
  if (prefs && !initialised) {
    setLocalPrefs({
      fresherOnly: prefs.fresherOnly,
      remotePreference: prefs.remotePreference,
      salaryMin: prefs.salaryMin,
      salaryCurrency: prefs.salaryCurrency,
    });
    setInitialised(true);
  }

  if (isLoading) {
    return (
      <div className="p-8 flex justify-center">
        <Loader2 className="animate-spin h-6 w-6" />
      </div>
    );
  }

  const handleSave = () => {
    updateMutation.mutate(localPrefs);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Preferences</h1>
        <p className="text-muted-foreground">Customize your job search criteria and filters.</p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Job Search Filters</CardTitle>
            <CardDescription>Adjust the strictness of your search.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="fresher-only">Fresher Only Mode</Label>
                <p className="text-sm text-muted-foreground">
                  Strictly filter out jobs requiring experience.
                </p>
              </div>
              <Switch
                id="fresher-only"
                checked={localPrefs.fresherOnly ?? false}
                onCheckedChange={(c) => setLocalPrefs((prev) => ({ ...prev, fresherOnly: c }))}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="remote">Remote Only</Label>
                <p className="text-sm text-muted-foreground">Only show remote positions.</p>
              </div>
              <Switch
                id="remote"
                checked={localPrefs.remotePreference === 'REMOTE_ONLY'}
                onCheckedChange={(c) =>
                  setLocalPrefs((prev) => ({
                    ...prev,
                    remotePreference: c ? 'REMOTE_ONLY' : 'ANY',
                  }))
                }
              />
            </div>

            <div className="space-y-2 max-w-xs">
              <Label htmlFor="salary">Minimum Salary Requirement</Label>
              <Input
                id="salary"
                type="number"
                placeholder="e.g. 500000"
                value={localPrefs.salaryMin ?? ''}
                onChange={(e) =>
                  setLocalPrefs((prev) => ({
                    ...prev,
                    salaryMin: Number(e.target.value) || null,
                  }))
                }
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={handleSave} disabled={updateMutation.isPending}>
              {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Preferences
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
