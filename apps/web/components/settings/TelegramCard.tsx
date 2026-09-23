'use client';

import { useState } from 'react';
import { Check, ExternalLink, Link2, Loader2, Send, Unlink } from 'lucide-react';
import type { TelegramLinkState } from '@jobsentinel/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  useSendTestAlert,
  useStartTelegramLink,
  useUnlinkTelegram,
} from '@/hooks/useNotifications';

/**
 * Telegram linking (docs 10 §4). The server issues a short-lived code; the user opens the deep
 * link and the bot completes the handshake, so nothing secret travels through the browser.
 */
export function TelegramCard({ telegram }: { telegram: TelegramLinkState }) {
  const startLink = useStartTelegramLink();
  const unlink = useUnlinkTelegram();
  const test = useSendTestAlert();
  const [linkUrl, setLinkUrl] = useState<string | null>(null);

  if (!telegram.available) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Telegram</CardTitle>
          <CardDescription>Instant alerts on your phone.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No Telegram bot is configured on the server, so alerts are written to your inbox only.
            Set <code className="rounded bg-muted px-1 py-0.5 text-xs">TELEGRAM_BOT_TOKEN</code> to
            enable it.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Telegram
          {telegram.linked && (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
              <Check className="size-3" /> Linked
            </span>
          )}
        </CardTitle>
        <CardDescription>
          {telegram.linked
            ? `Alerts go to ${telegram.username ? `@${telegram.username}` : 'your chat'}.`
            : 'Link your account to get instant alerts with an APPLY button.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {telegram.linked ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => test.mutate()}
              disabled={test.isPending}
            >
              {test.isPending ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Send className="mr-1.5 size-4" />
              )}
              Send a test alert
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => unlink.mutate()}
              disabled={unlink.isPending}
            >
              <Unlink className="mr-1.5 size-4" />
              Unlink
            </Button>
          </div>
        ) : (
          <>
            <Button
              size="sm"
              onClick={() => startLink.mutate(undefined, { onSuccess: (d) => setLinkUrl(d.url) })}
              disabled={startLink.isPending}
            >
              {startLink.isPending ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Link2 className="mr-1.5 size-4" />
              )}
              Link Telegram
            </Button>
            {linkUrl && (
              <div className="rounded-lg border border-border/60 bg-muted/40 p-3 text-sm">
                <p className="mb-2 text-muted-foreground">
                  Open this link on the device with Telegram, then press <strong>Start</strong>. The
                  code expires in 15 minutes.
                </p>
                <a
                  href={linkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
                >
                  {linkUrl}
                  <ExternalLink className="size-3.5" />
                </a>
              </div>
            )}
          </>
        )}

        {test.isSuccess && (
          <p className="text-sm text-success">Test alert queued — it arrives within a minute.</p>
        )}
        {(startLink.isError || unlink.isError || test.isError) && (
          <p className="text-sm text-destructive">
            That did not work. Check the API is running and try again.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
