'use client';

import { useSyncExternalStore } from 'react';

type NavigatorWithHints = Navigator & {
  userAgentData?: { platform: string };
};

function isApplePlatform() {
  const { userAgentData, platform } = navigator as NavigatorWithHints;

  return /mac|iphone|ipad|ipod/i.test(userAgentData?.platform ?? platform);
}

const subscribe = () => () => {};

/**
 * The key shown in shortcut hints: ⌘ on Apple devices, Ctrl elsewhere. The
 * server can't know the platform, so it renders Ctrl and the client corrects
 * it after hydration without a mismatch.
 */
export function useModifierKey() {
  return useSyncExternalStore(
    subscribe,
    () => (isApplePlatform() ? '⌘' : 'Ctrl'),
    () => 'Ctrl',
  );
}

/** Whether a key press is the platform's modifier plus the given key. */
export function isModifierShortcut(event: KeyboardEvent, key: string) {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === key
  );
}
