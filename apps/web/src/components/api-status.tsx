import { CircleAlert, CircleCheck } from 'lucide-react';
import { connection } from 'next/server';

import { Badge } from '@/components/ui/badge';
import { isApiHealthy } from '@/lib/api';

/** Whether the web app can reach the API, checked on every request. */
export async function ApiStatus() {
  await connection();
  const healthy = await isApiHealthy();

  return healthy ? (
    <Badge tone="success" icon={<CircleCheck />} data-testid="api-status">
      API reachable
    </Badge>
  ) : (
    <Badge tone="error" icon={<CircleAlert />} data-testid="api-status">
      API unreachable
    </Badge>
  );
}

/** Holds the badge's place while the check runs. */
export function ApiStatusPending() {
  return <Badge data-testid="api-status">Checking API</Badge>;
}
