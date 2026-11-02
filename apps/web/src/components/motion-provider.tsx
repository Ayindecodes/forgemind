'use client';

import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

import { transitions } from '@/lib/motion';

/**
 * Gives every Motion animation the base transition, and honours the user's
 * reduced-motion setting: movement is dropped while fades are kept.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={transitions.base}>
      {children}
    </MotionConfig>
  );
}
