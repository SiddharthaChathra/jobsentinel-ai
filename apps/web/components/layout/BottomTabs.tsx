'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { PRIMARY_NAV } from './nav-items';
import { InboxBell } from './InboxBell';

/**
 * Mobile navigation (< md). Five targets, thumb-reachable, with the safe-area inset respected
 * so the bar is not swallowed by the iOS home indicator (docs 04 §1: 360 px first).
 */
export function BottomTabs() {
  const pathname = usePathname();

  return (
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
      </ul>
    </nav>
  );
}
