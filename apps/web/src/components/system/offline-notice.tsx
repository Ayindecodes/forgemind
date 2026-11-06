'use client';

import { WifiOff } from 'lucide-react';
import { useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';

const subscribe = (listener: () => void) => {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
};

/** Whether the browser reports a network. True on the server, so nothing flashes. */
export const useOnline = () =>
  useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );

/** Shown across the app while the browser is offline. Drafts stay; live streams wait. */
export function OfflineNotice() {
  const online = useOnline();
  if (online) return null;

  return (
    <div
      role="alert"
      data-testid="offline-notice"
      className="flex flex-wrap items-center gap-3 border-b border-line bg-warning-subtle px-4 py-2 text-sm text-warning-fg"
    >
      <WifiOff aria-hidden="true" className="size-4 shrink-0" />
      <span className="flex-1">
        You are offline. What you see may be stale; live updates and drafts pick
        up where they left off once the network is back.
      </span>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => window.location.reload()}
      >
        Retry
      </Button>
    </div>
  );
}
