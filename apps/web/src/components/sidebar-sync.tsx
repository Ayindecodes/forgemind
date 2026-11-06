'use client';

import { useLayoutEffect } from 'react';

import { applySidebarMode, watchSidebarChanges } from '@/lib/sidebar';

export function SidebarSync() {
  useLayoutEffect(() => {
    // Strict Mode's dev remount clears the attribute the inline script set.
    applySidebarMode();

    return watchSidebarChanges();
  }, []);

  return null;
}
