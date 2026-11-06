import {
  FolderGit2,
  Gauge,
  GitPullRequest,
  History,
  LayoutDashboard,
  ListChecks,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = { href: string; label: string; icon: LucideIcon };

export const navItems: NavItem[] = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/repositories', label: 'Repositories', icon: FolderGit2 },
  { href: '/tasks', label: 'Engineering Tasks', icon: ListChecks },
  { href: '/security', label: 'Security', icon: ShieldCheck },
  { href: '/pull-requests', label: 'Pull Requests', icon: GitPullRequest },
  { href: '/history', label: 'Execution History', icon: History },
  { href: '/usage', label: 'Usage', icon: Gauge },
  { href: '/settings', label: 'Settings', icon: Settings },
];

/** The four that matter most on a phone. The rest live behind "More". */
export const mobileNavItems = navItems.filter(({ href }) =>
  ['/', '/tasks', '/repositories', '/security'].includes(href),
);

export const isActive = (pathname: string, href: string) =>
  href === '/'
    ? pathname === '/'
    : pathname === href || pathname.startsWith(`${href}/`);
