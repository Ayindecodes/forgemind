'use client';

import { X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect } from 'react';

import { Sidebar } from '@/components/shell/sidebar';
import { dialogOverlay } from '@/components/ui/dialog';
import { IconButton } from '@/components/ui/icon-button';
import { cx } from '@/lib/cx';
import { useReturnFocus } from '@/lib/use-return-focus';

/** Matches Tailwind's lg breakpoint, where the sidebar is always shown. */
const WIDE = '(min-width: 64rem)';

// The drawer comes in from the left edge it is attached to.
const fromLeft =
  '[--motion-shift-x:calc(-1*var(--motion-shift))] [--motion-shift-y:0px]';

/** The sidebar as a drawer, for screens too narrow to show it alongside the page. */
export function MobileNav({
  open,
  onOpenChange,
  onSearch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSearch: () => void;
}) {
  const returnFocus = useReturnFocus();

  // Once the window is wide enough for the sidebar, the drawer has no purpose.
  useEffect(() => {
    if (!open) return;

    const wide = matchMedia(WIDE);
    const close = () => {
      if (wide.matches) onOpenChange(false);
    };

    wide.addEventListener('change', close);
    return () => wide.removeEventListener('change', close);
  }, [open, onOpenChange]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content
          aria-modal="true"
          aria-describedby={undefined}
          data-testid="mobile-nav"
          className={cx(
            'material-overlay fixed inset-y-2 left-2 z-50 w-72 max-w-[calc(100%-1rem)] rounded-xl outline-none data-[state=closed]:motion-popover-out data-[state=open]:motion-popover-in',
            fromLeft,
          )}
          {...returnFocus}
        >
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <Sidebar onSearch={onSearch} onNavigate={() => onOpenChange(false)} />
          <Dialog.Close asChild>
            <IconButton
              label="Close navigation"
              variant="ghost"
              size="sm"
              icon={<X />}
              tooltip={false}
              className="absolute top-3.5 right-3"
            />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
