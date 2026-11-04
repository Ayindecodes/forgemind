import {
  Component,
  FolderGit2,
  LayoutGrid,
  ListChecks,
  Palette,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Other words people use for this page. The command palette matches them. */
  keywords?: readonly string[];
};

/** The product's sections. The sidebar and the command palette both read this. */
export const primaryNav: readonly NavItem[] = [
  {
    href: '/',
    label: 'Overview',
    icon: LayoutGrid,
    keywords: ['home', 'dashboard'],
  },
  {
    href: '/tasks',
    label: 'Tasks',
    icon: ListChecks,
    keywords: ['runs', 'agents', 'work'],
  },
  {
    href: '/repositories',
    label: 'Repositories',
    icon: FolderGit2,
    keywords: ['repos', 'code', 'codebases'],
  },
];

/** Pinned to the bottom of the sidebar. */
export const secondaryNav: readonly NavItem[] = [
  {
    href: '/settings',
    label: 'Settings',
    icon: Settings,
    keywords: ['preferences', 'appearance', 'theme'],
  },
];

/** The design system's own pages, which exist only in some builds. */
export const designNav: readonly NavItem[] = [
  {
    href: '/design',
    label: 'Foundations',
    icon: Palette,
    keywords: ['design', 'tokens'],
  },
  {
    href: '/design/components',
    label: 'Components',
    icon: Component,
    keywords: ['design'],
  },
];

/** A section stays current on its own pages, such as /tasks/42 for Tasks. */
export function isCurrent(href: string, pathname: string) {
  if (href === '/') return pathname === '/';

  return pathname === href || pathname.startsWith(`${href}/`);
}
