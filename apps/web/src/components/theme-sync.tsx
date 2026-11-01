'use client';

import { useLayoutEffect } from 'react';

import { applyTheme, watchThemeChanges } from '@/lib/theme';

export function ThemeSync() {
  useLayoutEffect(() => {
    // Strict Mode's dev remount clears the attribute the inline script set.
    applyTheme();

    return watchThemeChanges();
  }, []);

  return null;
}
