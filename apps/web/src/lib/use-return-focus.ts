'use client';

import { useRef } from 'react';

/**
 * Focus handlers for a Radix dialog that has no Dialog.Trigger. Radix returns
 * focus only to its own trigger, so a dialog with several ways in, such as a
 * button and a keyboard shortcut, would otherwise drop focus onto the page.
 *
 * This returns focus to whatever had it when the dialog opened, unless
 * something else, such as the dialog that replaced this one, has it by then.
 */
export function useReturnFocus() {
  const opener = useRef<HTMLElement | null>(null);

  return {
    // Runs before Radix moves focus in, so the opener still has it.
    onOpenAutoFocus: () => {
      const focused = document.activeElement;
      opener.current = focused instanceof HTMLElement ? focused : null;
    },
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();

      const focused = document.activeElement;
      if (!focused || focused === document.body) opener.current?.focus();
      opener.current = null;
    },
  };
}
