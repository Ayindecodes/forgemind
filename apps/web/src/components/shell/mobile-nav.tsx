'use client';

import { Menu as MenuIcon, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Dialog } from 'radix-ui';
import { useRef, useState } from 'react';

import { Logo } from '@/components/brand/logo';
import { IconButton } from '@/components/ui/icon-button';
import { cx } from '@/lib/cx';

import { isActive, mobileNavItems, navItems } from './nav';

/** Every destination, as a sheet. Opened from the top bar below the laptop width. */
export function NavSheet({ trigger }: { trigger: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const firstLink = useRef<HTMLAnchorElement>(null);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="material-scrim fixed inset-0 z-40 data-[state=closed]:motion-fade-out data-[state=open]:motion-fade-in" />
        <Dialog.Content
          aria-describedby={undefined}
          // Land on the list, not the close button, so nothing pops up uninvited.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            firstLink.current?.focus();
          }}
          className="material-overlay fixed inset-y-3 left-3 z-50 flex w-64 flex-col p-3 outline-none data-[state=closed]:motion-panel-out data-[state=open]:motion-panel-in"
        >
          <nav aria-label="Main">
            <div className="flex h-10 items-center justify-between pl-1">
              <Dialog.Title className="flex items-center">
                <Logo size={18} />
              </Dialog.Title>
              <Dialog.Close asChild>
                <IconButton
                  label="Close navigation"
                  variant="ghost"
                  size="sm"
                  icon={<X />}
                />
              </Dialog.Close>
            </div>
            <div className="mt-2">
              <ul className="flex flex-col gap-0.5">
                {navItems.map(({ href, label, icon: Icon }, index) => {
                  const active = isActive(pathname, href);
                  return (
                    <li key={href}>
                      <Link
                        ref={index === 0 ? firstLink : undefined}
                        href={href}
                        aria-current={active ? 'page' : undefined}
                        onClick={() => setOpen(false)}
                        className={cx(
                          'flex h-10 items-center gap-3 rounded-md px-3 text-base font-medium transition-colors',
                          active
                            ? 'bg-hover text-fg'
                            : 'text-fg-secondary hover:bg-hover hover:text-fg',
                        )}
                      >
                        <Icon aria-hidden="true" className="size-4" />
                        {label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A floating glass bar with the four destinations that matter on a phone. */
export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main, compact"
      className="material-toolbar fixed inset-x-3 bottom-3 z-30 flex h-14 items-stretch justify-around px-1 md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {mobileNavItems.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'flex min-w-14 flex-1 flex-col items-center justify-center gap-1 rounded-lg text-xs font-medium transition-colors',
              active ? 'text-fg' : 'text-fg-secondary hover:text-fg',
            )}
          >
            <Icon
              aria-hidden="true"
              className={cx('size-5', active && 'text-accent-fg')}
            />
            {label.replace('Engineering ', '')}
          </Link>
        );
      })}
      <NavSheet
        trigger={
          <button
            type="button"
            className="flex min-w-14 flex-1 flex-col items-center justify-center gap-1 rounded-lg text-xs font-medium text-fg-secondary transition-colors hover:text-fg"
          >
            <MenuIcon aria-hidden="true" className="size-5" />
            More
          </button>
        }
      />
    </nav>
  );
}
