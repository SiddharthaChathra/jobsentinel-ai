'use client';

import { useMe, useUpdateMe } from '@/hooks/useUser';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';

export default function SettingsPage() {
  const { data: me, isLoading } = useMe();
  const updateMutation = useUpdateMe();

  const [displayName, setDisplayName] = useState('');
  const [initialised, setInitialised] = useState(false);

  if (me && !initialised) {
    setDisplayName(me.user.displayName ?? '');
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
    updateMutation.mutate({ displayName: displayName || null });
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your account and notification settings.</p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Your personal information.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 max-w-sm">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={handleSave} disabled={updateMutation.isPending}>
              {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Settings
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Danger Zone</CardTitle>
            <CardDescription>Irreversible account actions.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="destructive">Delete Account</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
