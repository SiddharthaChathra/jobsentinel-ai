import type { ReactNode } from 'react';
import { BottomTabs } from './BottomTabs';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

/**
 * The authenticated frame (docs 04 §3): sidebar on ≥ md, bottom tabs below, sticky top bar
 * everywhere. Content is capped and centred so long job lists stay readable on a wide screen.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        {/* pb-20 clears the mobile tab bar; md:pb-10 drops it once the bar is gone. */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-20 pt-5 md:px-6 md:pb-10">
          {children}
        </main>
      </div>
      <BottomTabs />
    </div>
  );
}
