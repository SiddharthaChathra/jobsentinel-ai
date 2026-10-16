import type { MetadataRoute } from 'next';

/** Install metadata (Add to Home Screen / Install app); icons come from scripts/generate-icons.mjs. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'JobSentinel AI',
    short_name: 'JobSentinel',
    description: 'Verified fresher jobs, matched to your resume.',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#4f46e5',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
