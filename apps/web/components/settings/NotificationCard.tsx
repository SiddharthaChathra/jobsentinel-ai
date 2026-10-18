'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { NotificationMode, NotificationSettings } from '@jobsentinel/types';
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
import { useUpdateNotificationSettings } from '@/hooks/useNotifications';

const MODES: { value: NotificationMode; label: string; hint: string }[] = [
  {
    value: 'BOTH',
    label: 'Instant + daily digest',
    hint: 'Strong matches immediately, everything else once a day',
  },
  { value: 'INSTANT', label: 'Instant only', hint: 'Only strong matches, as they are found' },
  { value: 'DIGEST', label: 'Daily digest only', hint: 'One summary a day, nothing in between' },
  { value: 'DISABLED', label: 'Off', hint: 'Nothing is sent; the inbox still fills' },
];

/** Alert preferences (docs 10 §6). Quiet hours delay an alert — they never cancel it. */
export function NotificationCard({ settings }: { settings: NotificationSettings }) {
  const update = useUpdateNotificationSettings();
  const [form, setForm] = useState(settings);
  const [lastSynced, setLastSynced] = useState(settings);

  // Re-sync when the server hands back a newer object. Adjusting state during render is React's
  // documented pattern for this; doing it in an effect renders once with stale values first.
  if (settings !== lastSynced) {
    setLastSynced(settings);
    setForm(settings);
  }

  const quietOn = form.quietHoursStart !== null && form.quietHoursEnd !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alerts</CardTitle>
        <CardDescription>When JobSentinel should interrupt you.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Mode</legend>
          {MODES.map((m) => (
            <label
              key={m.value}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 p-3 has-checked:border-primary/50 has-checked:bg-primary/5"
            >
              <input
                type="radio"
                name="mode"
                value={m.value}
                checked={form.mode === m.value}
                onChange={() => setForm({ ...form, mode: m.value })}
                className="mt-1 accent-primary"
              />
              <span>
                <span className="block text-sm font-medium">{m.label}</span>
                <span className="block text-xs text-muted-foreground">{m.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="instantMinScore">Instant alert threshold</Label>
            <Input
              id="instantMinScore"
              type="number"
              min={0}
              max={100}
              value={form.instantMinScore}
              onChange={(e) => setForm({ ...form, instantMinScore: Number(e.target.value) })}
            />
            <p className="text-xs text-muted-foreground">
              Matches below this score wait for the digest.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="digestHour">Digest hour (your time)</Label>
            <Input
              id="digestHour"
              type="number"
              min={0}
              max={23}
              value={form.digestHourLocal}
              onChange={(e) => setForm({ ...form, digestHourLocal: Number(e.target.value) })}
            />
            <p className="text-xs text-muted-foreground">24-hour clock, e.g. 8 for 8 am.</p>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-border/60 p-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Quiet hours</p>
              <p className="text-xs text-muted-foreground">
                Alerts are held until the window ends, never dropped.
              </p>
            </div>
            <Switch
              checked={quietOn}
              onCheckedChange={(on) =>
                setForm({
                  ...form,
                  quietHoursStart: on ? 22 : null,
                  quietHoursEnd: on ? 7 : null,
                })
              }
            />
          </div>
          {quietOn && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="quietStart">From</Label>
                <Input
                  id="quietStart"
                  type="number"
                  min={0}
                  max={23}
                  value={form.quietHoursStart ?? 22}
                  onChange={(e) => setForm({ ...form, quietHoursStart: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quietEnd">Until</Label>
                <Input
                  id="quietEnd"
                  type="number"
                  min={0}
                  max={23}
                  value={form.quietHoursEnd ?? 7}
                  onChange={(e) => setForm({ ...form, quietHoursEnd: Number(e.target.value) })}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Include unverified jobs in the digest</p>
            <p className="text-xs text-muted-foreground">
              Jobs we could not confirm, clearly labelled. They are never sent as instant alerts.
            </p>
          </div>
          <Switch
            checked={form.includeNeedsReviewInDigest}
            onCheckedChange={(on) => setForm({ ...form, includeNeedsReviewInDigest: on })}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Send to Telegram</p>
            <p className="text-xs text-muted-foreground">
              Turn off to keep alerts in the web inbox only.
            </p>
          </div>
          <Switch
            checked={form.telegramEnabled}
            onCheckedChange={(on) => setForm({ ...form, telegramEnabled: on })}
          />
        </div>

        <div className="space-y-4 rounded-lg border border-border/60 p-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Reminders</p>
              <p className="text-xs text-muted-foreground">
                Follow-up, interview and deadline alerts for your applications.
              </p>
            </div>
            <Switch
              checked={form.remindersEnabled ?? true}
              onCheckedChange={(on) => setForm({ ...form, remindersEnabled: on })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="followUpDays">Follow up after N days</Label>
            <Input
              id="followUpDays"
              type="number"
              min={3}
              max={14}
              value={form.followUpDays ?? 7}
              onChange={(e) => setForm({ ...form, followUpDays: Number(e.target.value) })}
            />
            <p className="text-xs text-muted-foreground">
              Days with no status change after applying before a follow-up reminder (3–14).
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Weekly summary on Sunday 09:00</p>
            <p className="text-xs text-muted-foreground">
              A weekly summary of jobs, applications and reminders in your timezone.
            </p>
          </div>
          <Switch
            checked={form.weeklySummaryEnabled ?? false}
            onCheckedChange={(on) => setForm({ ...form, weeklySummaryEnabled: on })}
          />
        </div>
      </CardContent>

      <CardFooter className="flex items-center gap-3 border-t border-border/60 pt-4">
        <Button
          onClick={() =>
            update.mutate({
              mode: form.mode,
              instantMinScore: form.instantMinScore,
              digestHourLocal: form.digestHourLocal,
              quietHoursStart: form.quietHoursStart,
              quietHoursEnd: form.quietHoursEnd,
              includeNeedsReviewInDigest: form.includeNeedsReviewInDigest,
              telegramEnabled: form.telegramEnabled,
              remindersEnabled: form.remindersEnabled ?? true,
              followUpDays: form.followUpDays ?? 7,
              weeklySummaryEnabled: form.weeklySummaryEnabled ?? false,
            })
          }
          disabled={update.isPending}
        >
          {update.isPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
          Save alert settings
        </Button>
        {update.isSuccess && <span className="text-sm text-success">Saved.</span>}
        {update.isError && <span className="text-sm text-destructive">Could not save.</span>}
      </CardFooter>
    </Card>
  );
}
