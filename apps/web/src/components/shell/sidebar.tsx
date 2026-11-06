'use client';

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId } from 'react';

import { ForgeMark, Logo } from '@/components/brand/logo';
import { Tooltip } from '@/components/ui/tooltip';
import { cx } from '@/lib/cx';
import { setSidebarMode } from '@/lib/sidebar';
import { useMediaQuery } from '@/lib/use-media-query';
import { useSidebarMode } from '@/lib/use-sidebar';

import { isActive, navItems } from './nav';

const LAPTOP = '(min-width: 64rem) and (max-width: 79.99rem)';

export function Sidebar() {
  const pathname = usePathname();
  const mode = useSidebarMode();
  const laptop = useMediaQuery(LAPTOP);
  const compact = mode === 'compact' || laptop;
  const layoutId = useId();

  return (
    <nav
      aria-label="Main"
      data-compact={compact || undefined}
      className="material-nav fixed inset-y-0 left-0 z-30 hidden w-(--sidebar-width) flex-col rounded-none border-y-0 border-l-0 transition-[width] duration-base ease-standard lg:flex"
    >
      <div className="flex h-(--topbar-height) shrink-0 items-center px-4">
        <Link
          href="/"
          aria-label="ForgeMind home"
          className="flex items-center rounded-md text-fg"
        >
          {compact ? <ForgeMark size={20} /> : <Logo size={18} />}
        </Link>
      </div>

      <ul className="flex flex-1 flex-col gap-0.5 px-2 pt-2">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          const link = (
            <Link
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'relative flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium transition-colors',
                active
                  ? 'bg-hover text-fg'
                  : 'text-fg-secondary hover:bg-hover hover:text-fg',
                compact && 'justify-center px-0',
              )}
            >
              {active && (
                <motion.span
                  layoutId={layoutId}
                  aria-hidden="true"
                  className="absolute top-2 bottom-2 -left-2 w-0.5 rounded-full bg-accent"
                />
              )}
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              <span className={cx('truncate', compact && 'sr-only')}>
                {label}
              </span>
            </Link>
          );

          return (
            <li key={href}>
              {compact ? (
                <Tooltip content={label} side="right">
                  {link}
                </Tooltip>
              ) : (
                link
              )}
            </li>
          );
        })}
      </ul>

      <div
        className={cx(
          'hidden p-2 xl:flex',
          compact ? 'justify-center' : 'justify-end',
        )}
      >
        <Tooltip
          content={compact ? 'Expand sidebar' : 'Collapse sidebar'}
          side="right"
        >
          <button
            type="button"
            aria-pressed={mode === 'compact'}
            aria-label={compact ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() =>
              setSidebarMode(mode === 'compact' ? 'expanded' : 'compact')
            }
            className="press flex size-8 items-center justify-center rounded-md text-fg-secondary transition-colors hover:bg-hover hover:text-fg"
          >
            {compact ? (
              <PanelLeftOpen aria-hidden="true" className="size-4" />
            ) : (
              <PanelLeftClose aria-hidden="true" className="size-4" />
            )}
          </button>
        </Tooltip>
      </div>
    </nav>
  );
}
