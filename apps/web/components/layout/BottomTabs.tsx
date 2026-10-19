'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MoreHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PRIMARY_NAV, SECONDARY_NAV } from './nav-items';
import { InboxBell } from './InboxBell';

/**
 * Mobile navigation (< md). Five thumb-reachable targets (Dashboard, Jobs, Saved, Applications,
 * and More) respecting the safe-area inset (docs 04 §1: 360 px first).
 * The "More" entry houses /skill-gaps, Inbox, Resume, Preferences, System and Settings without
 * crowding the bottom bar (defect 11).
 */
export function BottomTabs() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setMoreOpen(false);
  }

  useEffect(() => {
    if (!moreOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [moreOpen]);

  const isSecondaryActive = SECONDARY_NAV.some(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );

  return (
    <>
      {moreOpen && (
        <div
          data-testid="bottom-nav-backdrop"
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-xs md:hidden"
          onClick={() => setMoreOpen(false)}
          aria-hidden="true"
        />
      )}

      {moreOpen && (
        <div
          role="dialog"
          aria-label="More navigation"
          data-testid="bottom-nav-more-menu"
          className="fixed inset-x-0 bottom-14 z-50 mx-auto max-w-lg rounded-t-2xl border-t border-x border-border/80 bg-background p-4 shadow-xl md:hidden"
        >
          <div className="mb-3 flex items-center justify-between border-b border-border/40 pb-2">
            <h2 className="text-sm font-semibold">More</h2>
            <button
              type="button"
              onClick={() => setMoreOpen(false)}
              aria-label="Close menu"
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
          <ul className="grid grid-cols-2 gap-2">
            {SECONDARY_NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    data-testid={`more-nav-${item.href.replace('/', '')}`}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg border border-border/50 p-2.5 text-xs font-medium transition-colors',
                      active
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'text-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    <item.icon
                      className={cn(
                        'size-4 shrink-0',
                        active ? 'text-primary' : 'text-muted-foreground',
                      )}
                    />
                    <span className="truncate flex-1">{item.label}</span>
                    {item.href === '/notifications' && <InboxBell variant="count" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 backdrop-blur md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Primary"
      >
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {PRIMARY_NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex h-14 flex-col items-center justify-center gap-1 text-[11px] transition-colors',
                    active ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  <span className="relative">
                    <item.icon className="size-5" />
                    {item.href === '/notifications' && <InboxBell variant="dot" />}
                  </span>
                  <span className="leading-none">{item.label}</span>
                  {active && (
                    <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-primary" />
                  )}
                </Link>
              </li>
            );
          })}

          <li>
            <button
              type="button"
              onClick={() => setMoreOpen((open) => !open)}
              aria-expanded={moreOpen}
              aria-haspopup="dialog"
              aria-label="More navigation"
              data-testid="bottom-nav-more"
              className={cn(
                'relative flex h-14 w-full flex-col items-center justify-center gap-1 text-[11px] transition-colors',
                moreOpen || isSecondaryActive ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <span className="relative">
                <MoreHorizontal className="size-5" />
                <InboxBell variant="dot" />
              </span>
              <span className="leading-none">More</span>
              {(moreOpen || isSecondaryActive) && (
                <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-primary" />
              )}
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
