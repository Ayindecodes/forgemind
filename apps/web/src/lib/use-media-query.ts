'use client';

import { useSyncExternalStore } from 'react';

/** Matches a media query. Reads false on the server and before hydration. */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (listener) => {
      const media = matchMedia(query);
      media.addEventListener('change', listener);
      return () => media.removeEventListener('change', listener);
    },
    () => matchMedia(query).matches,
    () => false,
  );
}
