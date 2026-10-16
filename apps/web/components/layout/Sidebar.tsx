'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { NAV_ITEMS } from './nav-items';
import { InboxBell } from './InboxBell';
import { Logo } from '@/components/brand/Logo';

/** Desktop navigation (≥ md). The mobile equivalent is `BottomTabs`. */
export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex md:w-60 md:shrink-0 md:flex-col md:border-r md:border-border/60 md:bg-sidebar">
      <div className="flex h-16 items-center gap-2 px-5">
        <Logo size={32} />
        <span className="text-[15px] font-semibold tracking-tight">JobSentinel</span>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-2">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <item.icon className={cn('size-4 shrink-0', active && 'text-primary')} />
              <span className="truncate">{item.label}</span>
              {item.href === '/notifications' && <InboxBell variant="count" />}
            </Link>
          );
        })}
      </nav>

      <p className="px-5 pb-4 text-[11px] leading-relaxed text-muted-foreground">
        Every job is verified before it reaches you.
      </p>
    </aside>
  );
}
