'use client';

import type { Run } from '@forgemind/contract';
import { useEffect, useRef, useState } from 'react';

import { announcements } from '@/lib/live/announce';

/**
 * A polite live region that speaks what changed in the run. Visually hidden;
 * the screen shows the same facts in the summary and the timeline.
 */
export function RunAnnouncer({ run }: { run: Run }) {
  const previous = useRef<Run | null>(null);
  const [spoken, setSpoken] = useState('');

  useEffect(() => {
    const lines = announcements(previous.current, run);
    previous.current = run;
    if (lines.length > 0) {
      // Screen readers announce a change of text; a timestamp keeps repeats distinct.
      const timer = setTimeout(() => setSpoken(lines.join('. ') + '.'), 0);
      return () => clearTimeout(timer);
    }
  }, [run]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      data-testid="run-announcer"
    >
      {spoken}
    </div>
  );
}
