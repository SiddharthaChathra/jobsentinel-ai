'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { NotificationCard } from '@/components/settings/NotificationCard';
import { TelegramCard } from '@/components/settings/TelegramCard';
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
import { useNotificationSettings } from '@/hooks/useNotifications';
import { useMe, useUpdateMe } from '@/hooks/useUser';

export default function SettingsPage() {
  const { data: me, isLoading: meLoading } = useMe();
  const updateMe = useUpdateMe();
  const { data: notifications, isLoading: notifLoading } = useNotificationSettings();

  const serverName = me?.user.displayName ?? '';
  const [displayName, setDisplayName] = useState(serverName);
  const [lastSynced, setLastSynced] = useState(serverName);
  if (serverName !== lastSynced) {
    setLastSynced(serverName);
    setDisplayName(serverName);
  }

  return (
    <>
      <PageHeader title="Settings" description="Your account, alerts and Telegram link." />

      <div className="grid max-w-3xl gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>{me?.user.email ?? 'Loading…'}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              <Label htmlFor="displayName">Display name</Label>
              <Input
                id="displayName"
                value={displayName}
                placeholder="How should we greet you?"
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={meLoading}
              />
            </div>
          </CardContent>
          <CardFooter className="flex items-center gap-3 border-t border-border/60 pt-4">
            <Button
              onClick={() => updateMe.mutate({ displayName: displayName.trim() || null })}
              disabled={updateMe.isPending || meLoading}
            >
              {updateMe.isPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Save
            </Button>
            {updateMe.isSuccess && <span className="text-sm text-success">Saved.</span>}
          </CardFooter>
        </Card>

        {notifLoading && (
          <div className="h-64 animate-pulse rounded-xl border border-border/60 bg-muted/40" />
        )}
        {notifications && <NotificationCard settings={notifications} />}
        {notifications && <TelegramCard telegram={notifications.telegram} />}

        <Card>
          <CardHeader>
            <CardTitle>Your data</CardTitle>
            <CardDescription>What JobSentinel stores, and where.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              Your resume file is kept in private storage and is only ever read by the parser. Job
              alerts contain job details only — never anything from your resume.
            </p>
            <p>
              To remove everything, delete the Supabase auth user: the database cascades from it, so
              your profile, matches, saved jobs and alerts go with it.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
