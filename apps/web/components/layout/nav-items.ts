import {
  Bell,
  Bookmark,
  Briefcase,
  FileText,
  LayoutDashboard,
  Send,
  Settings,
  SlidersHorizontal,
  Activity,
  GraduationCap,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown in the mobile tab bar — only the five that matter on a phone. */
  primary?: boolean;
}

/** One definition drives the sidebar, the mobile tabs and the page titles. */
export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, primary: true },
  { href: '/jobs', label: 'Jobs', icon: Briefcase, primary: true },
  { href: '/saved', label: 'Saved', icon: Bookmark, primary: true },
  { href: '/applications', label: 'Applications', icon: Send, primary: true },
  { href: '/skill-gaps', label: 'Skill gaps', icon: GraduationCap },
  { href: '/notifications', label: 'Inbox', icon: Bell, primary: true },
  { href: '/resume', label: 'Resume', icon: FileText },
  { href: '/preferences', label: 'Preferences', icon: SlidersHorizontal },
  { href: '/system', label: 'System', icon: Activity },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export const PRIMARY_NAV = NAV_ITEMS.filter((i) => i.primary);

export function titleForPath(pathname: string): string {
  const match = NAV_ITEMS.filter((i) => pathname.startsWith(i.href)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
  return match?.label ?? 'JobSentinel';
}
