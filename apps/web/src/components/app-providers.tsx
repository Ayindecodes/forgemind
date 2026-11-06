'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from 'radix-ui';
import { useEffect, useState, type ReactNode } from 'react';

import { MotionProvider } from '@/components/motion-provider';
import { Toaster } from '@/components/ui/toast';
import { timeouts } from '@/lib/motion';
import { createQueryClient } from '@/lib/queries';

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);

  // Runs after every descendant's effects, so by now the page is hydrated and
  // interactive. Browser tests wait for this before pressing anything.
  useEffect(() => {
    document.documentElement.setAttribute('data-hydrated', '');
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <MotionProvider>
        <Tooltip.Provider delayDuration={timeouts.tooltip}>
          {children}
          <Toaster />
        </Tooltip.Provider>
      </MotionProvider>
    </QueryClientProvider>
  );
}
