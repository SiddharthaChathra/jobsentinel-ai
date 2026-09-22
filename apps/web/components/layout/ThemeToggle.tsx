'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';

const STORAGE_KEY = 'jobsentinel-theme';

/**
 * Light/dark toggle. The `<html>` class is the single source of truth — an inline script in the
 * root layout sets it before first paint — so this subscribes to that element rather than
 * keeping a second copy in React state that could disagree with it.
 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

export function ThemeToggle() {
  const dark = useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains('dark'),
    () => false, // the server always renders the light icon; the script corrects it before paint
  );

  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
    } catch {
      // Private mode: the toggle still works for this session.
    }
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </button>
  );
}
