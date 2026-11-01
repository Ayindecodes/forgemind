'use client';

import { useSyncExternalStore } from 'react';

import {
  readThemePreference,
  subscribeToTheme,
  type ThemePreference,
} from '@/lib/theme';

const serverPreference = (): ThemePreference => 'system';

export function useThemePreference() {
  return useSyncExternalStore(
    subscribeToTheme,
    readThemePreference,
    serverPreference,
  );
}
