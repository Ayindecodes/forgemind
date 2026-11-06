'use client';

import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { useDataSource } from '@/lib/queries';

/** Says so when every number on screen comes from the development API. */
export function DataSourceBadge() {
  const source = useDataSource();
  if (source !== 'demo') return null;

  return (
    <Tooltip content="Responses come from the development API, not a real backend.">
      <Badge
        tone="warning"
        className="cursor-default"
        data-testid="data-source"
      >
        Demo data
      </Badge>
    </Tooltip>
  );
}
