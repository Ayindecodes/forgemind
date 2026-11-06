'use client';

import { useEffect, useState } from 'react';

/** The current time, refreshed on an interval while `active`. */
export function useNow(active: boolean, everyMs = 1000) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs]);

  return now;
}
