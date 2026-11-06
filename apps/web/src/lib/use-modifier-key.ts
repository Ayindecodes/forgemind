'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const read = () => (/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl');
const server = () => 'Ctrl' as const;

/** "⌘" on Apple devices, "Ctrl" elsewhere. Settles after hydration. */
export const useModifierKey = () =>
  useSyncExternalStore(subscribe, read, server);
