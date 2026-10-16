'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell } from 'lucide-react';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { ThemeToggle } from './ThemeToggle';
import { InboxBell } from './InboxBell';
import { titleForPath } from './nav-items';
import { Logo } from '@/components/brand/Logo';

/**
 * Sticky header. On mobile it carries the brand (the sidebar is hidden there); on desktop it
 * carries the current page title, so the user always knows where they are.
 */
export function TopBar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/60 bg-background/90 px-4 backdrop-blur md:h-16 md:px-6">
      <Link href="/dashboard" className="flex items-center gap-2 md:hidden">
        <Logo size={28} />
        <span className="text-sm font-semibold tracking-tight">JobSentinel</span>
      </Link>

      <h1 className="hidden text-base font-semibold tracking-tight md:block">
        {titleForPath(pathname)}
      </h1>

      <div className="ml-auto flex items-center gap-1">
        <Link
          href="/notifications"
          aria-label="Inbox"
          className="relative grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
        >
          <Bell className="size-[18px]" />
          <InboxBell variant="dot" />
        </Link>
        <ThemeToggle />
        <SignOutButton />
      </div>
    </header>
  );
}
