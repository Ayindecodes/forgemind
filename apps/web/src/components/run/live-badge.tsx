'use client';

import { CircleCheck, LoaderCircle, WifiOff } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { StreamConnection } from '@/lib/live/event-stream';

/** The state of the live connection, announced as it changes. */
export function LiveBadge({
  connection,
  onRetry,
}: {
  connection: StreamConnection;
  onRetry?: () => void;
}) {
  const { status, attempts } = connection;

  return (
    <span role="status" className="inline-flex items-center gap-2">
      {status === 'connecting' ? (
        <Badge icon={<LoaderCircle className="animate-spin" />}>
          Connecting
        </Badge>
      ) : status === 'live' ? (
        <Badge
          tone="success"
          icon={
            <span
              aria-hidden="true"
              className="block size-2 rounded-full bg-current animate-pulse"
            />
          }
        >
          Live
        </Badge>
      ) : status === 'reconnecting' ? (
        <Badge tone="warning" icon={<LoaderCircle className="animate-spin" />}>
          Reconnecting{attempts > 1 ? ` (${attempts})` : ''}
        </Badge>
      ) : status === 'ended' ? (
        <Badge icon={<CircleCheck />}>Stream ended</Badge>
      ) : (
        <>
          <Badge tone="error" icon={<WifiOff />}>
            Disconnected
          </Badge>
          {onRetry && (
            <Button size="sm" variant="ghost" onClick={onRetry}>
              Retry
            </Button>
          )}
        </>
      )}
    </span>
  );
}
