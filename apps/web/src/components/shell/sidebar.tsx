'use client';

import { Search } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId } from 'react';

import { Logo } from '@/components/brand/logo';
import { Shortcut } from '@/components/ui/kbd';
import { cx } from '@/lib/cx';
import {
  isCurrent,
  primaryNav,
  secondaryNav,
  type NavItem,
} from '@/lib/navigation';
import { useModifierKey } from '@/lib/use-modifier-key';

const row =
  'press relative flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-base font-medium transition-colors';

const idle = 'text-fg-secondary hover:bg-hover hover:text-fg';

/**
 * The sidebar's contents: the logo, search and the product's sections. The
 * desktop sidebar and the mobile navigation drawer both render it.
 */
export function Sidebar({
  onSearch,
  onNavigate,
}: {
  onSearch: () => void;
  /** Runs when a link is followed, so the mobile drawer can close. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const modifier = useModifierKey();
  // Each copy of the sidebar gets its own indicator, so opening the mobile
  // drawer never animates the highlight across from the hidden desktop one.
  const indicator = useId();

  const link = (item: NavItem) => {
    const current = isCurrent(item.href, pathname);
    const Icon = item.icon;

    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-current={current ? 'page' : undefined}
          onClick={onNavigate}
          className={cx(row, current ? 'text-fg' : idle)}
        >
          {current && (
            <motion.span
              layoutId={indicator}
              aria-hidden="true"
              className="absolute inset-0 rounded-md bg-pressed"
            />
          )}
          <Icon aria-hidden="true" className="relative size-4 shrink-0" />
          <span className="relative">{item.label}</span>
        </Link>
      </li>
    );
  };

  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <Link
        href="/"
        onClick={onNavigate}
        className="flex h-8 items-center self-start rounded-md px-2.5 text-fg"
      >
        <Logo size={16} />
      </Link>

      <button
        type="button"
        onClick={onSearch}
        aria-keyshortcuts="Control+K Meta+K"
        className={cx(row, idle)}
      >
        <Search aria-hidden="true" className="size-4 shrink-0" />
        <span className="flex-1 text-left">Search</span>
        <span aria-hidden="true">
          <Shortcut keys={[modifier, 'K']} />
        </span>
      </button>

      <nav aria-label="Main" className="flex flex-1 flex-col">
        <ul className="flex flex-col gap-0.5">{primaryNav.map(link)}</ul>
        <ul className="mt-auto flex flex-col gap-0.5">
          {secondaryNav.map(link)}
        </ul>
      </nav>
    </div>
  );
}
