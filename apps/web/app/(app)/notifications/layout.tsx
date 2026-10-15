import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// The page itself is a client component, which cannot export metadata.
export const metadata: Metadata = { title: 'Inbox' };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
