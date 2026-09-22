import { redirect } from 'next/navigation';

// The root is never a page: proxy.ts sends unauthenticated users to /login.
export default function Home() {
  redirect('/dashboard');
}
