import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// The page itself is a client component, which cannot export metadata. A plain string title here
// would also stop the root template reaching /jobs/[id] ("Job Details" with no suffix), so the
// template is restated. The root template still wraps `default`, which is what /jobs shows.
export const metadata: Metadata = {
  title: { default: 'Jobs', template: '%s · JobSentinel AI' },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
