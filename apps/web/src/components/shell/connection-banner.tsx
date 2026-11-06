'use client';

import { WifiOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { API_URL, ApiUnreachableError } from '@/lib/api-client';
import { useSession } from '@/lib/queries';

/** Shown under the top bar while the API cannot be reached. */
export function ConnectionBanner() {
  const session = useSession();
  if (!(session.error instanceof ApiUnreachableError)) return null;

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 border-b border-line bg-error-subtle px-4 py-2 text-sm md:px-6"
    >
      <WifiOff aria-hidden="true" className="size-4 shrink-0 text-error-fg" />
      <span className="flex-1">
        Can&apos;t reach the API at{' '}
        <span className="font-mono text-code">{API_URL}</span>. Nothing shown
        here is current.
      </span>
      <Button
        size="sm"
        loading={session.isFetching}
        onClick={() => void session.refetch()}
      >
        Retry
      </Button>
    </div>
  );
}
