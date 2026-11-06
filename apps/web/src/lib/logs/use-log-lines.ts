'use client';

import type { Event } from '@forgemind/contract';
import { useMemo, useState } from 'react';

import { LogBuilder, type LogLine } from './log-lines';

/**
 * The log lines of one run, extended as its events arrive. Mount the
 * component that calls this with a key per run, so a new run gets a new log.
 */
export function useLogLines(events: readonly Event[]): LogLine[] {
  const [builder] = useState(() => new LogBuilder());

  // A fresh array each time, so memoised consumers see the change.
  return useMemo(() => [...builder.append(events)], [builder, events]);
}
