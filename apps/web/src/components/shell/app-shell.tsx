'use client';

import { Menu, Search } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState, type ReactNode } from 'react';

import { Logo } from '@/components/brand/logo';
import { CommandPalette } from '@/components/shell/command-palette';
import { MobileNav } from '@/components/shell/mobile-nav';
import { Sidebar } from '@/components/shell/sidebar';
import { IconButton } from '@/components/ui/icon-button';

/**
 * The frame around every product page. Wide screens get a floating glass
 * sidebar; narrow ones get a glass header that opens the same sidebar as a
 * drawer. The command palette is reachable from both, and from ⌘K or Ctrl+K.
 */
export function AppShell({
  designPages,
  children,
}: {
  designPages: boolean;
  children: ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // The palette replaces the navigation drawer rather than stacking on it.
  const showPalette = useCallback((open: boolean) => {
    if (open) setNavOpen(false);
    setPaletteOpen(open);
  }, []);
  const openPalette = useCallback(() => showPalette(true), [showPalette]);

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-70 focus:rounded-md focus:bg-elevated focus:px-3 focus:py-1.5 focus:text-sm focus:font-medium focus:shadow-md"
      >
        Skip to content
      </a>

      <div className="material-nav fixed inset-y-2 left-2 z-30 hidden w-60 rounded-xl lg:block">
        <Sidebar onSearch={openPalette} />
      </div>

      <header className="material-nav sticky top-0 z-30 flex h-12 items-center gap-1 border-x-0 border-t-0 px-2 lg:hidden">
        <IconButton
          label="Open navigation"
          variant="ghost"
          icon={<Menu />}
          tooltip={false}
          aria-haspopup="dialog"
          aria-expanded={navOpen}
          onClick={() => setNavOpen(true)}
        />
        <Link href="/" className="flex h-8 items-center rounded-md px-1.5">
          <Logo size={16} />
        </Link>
        <IconButton
          label="Search"
          variant="ghost"
          icon={<Search />}
          tooltip={false}
          aria-keyshortcuts="Control+K Meta+K"
          className="ml-auto"
          onClick={openPalette}
        />
      </header>

      <MobileNav
        open={navOpen}
        onOpenChange={setNavOpen}
        onSearch={openPalette}
      />

      <main id="main" tabIndex={-1} className="outline-none lg:pl-64">
        {children}
      </main>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={showPalette}
        designPages={designPages}
      />
    </>
  );
}
