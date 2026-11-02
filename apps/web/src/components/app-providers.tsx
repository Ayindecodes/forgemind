'use client';

import { Tooltip } from 'radix-ui';
import { useEffect, type ReactNode } from 'react';

import { MotionProvider } from '@/components/motion-provider';
import { Toaster } from '@/components/ui/toast';
import { timeouts } from '@/lib/motion';

export function AppProviders({ children }: { children: ReactNode }) {
  // Runs after every descendant's effects, so by now the page is hydrated and
  // interactive. Browser tests wait for this before pressing anything.
  useEffect(() => {
    document.documentElement.setAttribute('data-hydrated', '');
  }, []);

  return (
    <MotionProvider>
      <Tooltip.Provider delayDuration={timeouts.tooltip}>
        {children}
        <Toaster />
      </Tooltip.Provider>
    </MotionProvider>
  );
}
