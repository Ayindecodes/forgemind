'use client';

import { Menu as MenuIcon, Search } from 'lucide-react';

import { Logo } from '@/components/brand/logo';
import { IconButton } from '@/components/ui/icon-button';
import { Shortcut } from '@/components/ui/kbd';
import { useModifierKey } from '@/lib/use-modifier-key';

import { useCommandCenter } from './command-center';

import { ConnectionBanner } from './connection-banner';
import { DataSourceBadge } from './data-source-badge';
import { NavSheet } from './mobile-nav';
import { Notifications } from './notifications';
import { OrgMenu } from './org-menu';
import { ProfileMenu } from './profile-menu';
import { RepositorySelector } from './repository-selector';

/** Opens the command palette, which listens for this. */
export const COMMAND_PALETTE_EVENT = 'forgemind:command-palette';

export function TopBar() {
  const { openPalette } = useCommandCenter();
  const mod = useModifierKey();

  return (
    <header className="sticky top-0 z-20">
      <div className="material-nav flex h-(--topbar-height) items-center gap-2 rounded-none border-x-0 border-t-0 px-3 md:px-4">
        <div className="flex items-center gap-1 lg:hidden">
          <NavSheet
            trigger={
              <IconButton
                label="Open navigation"
                variant="ghost"
                icon={<MenuIcon />}
                data-testid="open-navigation"
              />
            }
          />
          <span className="flex items-center text-fg md:hidden">
            <Logo size={16} />
          </span>
        </div>

        <div className="hidden items-center gap-1 md:flex">
          <OrgMenu />
          <RepositorySelector />
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={openPalette}
            data-testid="search-trigger"
            className="press hidden h-8 w-56 items-center gap-2 rounded-md border border-line-control bg-elevated px-2.5 text-sm text-fg-muted transition-colors hover:border-fg-muted sm:flex"
          >
            <Search aria-hidden="true" className="size-4" />
            <span className="flex-1 text-left">Search</span>
            <Shortcut keys={[mod, 'K']} />
          </button>
          <IconButton
            label="Search"
            variant="ghost"
            icon={<Search />}
            onClick={openPalette}
            className="sm:hidden"
          />
          <DataSourceBadge />
          <Notifications />
          <ProfileMenu />
        </div>
      </div>
      <ConnectionBanner />
    </header>
  );
}
