'use client';

import { Tooltip } from 'radix-ui';
import type { ReactNode } from 'react';

import { MotionProvider } from '@/components/motion-provider';
import { Toaster } from '@/components/ui/toast';
import { timeouts } from '@/lib/motion';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <MotionProvider>
      <Tooltip.Provider delayDuration={timeouts.tooltip}>
        {children}
        <Toaster />
      </Tooltip.Provider>
    </MotionProvider>
  );
}
