'use client';

import { useReducedMotion } from 'motion/react';
import { useMemo } from 'react';

import {
  collapse,
  fade,
  panel,
  popover,
  withoutMovement,
  type Side,
} from '@/lib/motion';

/** The motion presets, with movement removed when the user asks for less motion. */
export function useMotionPresets() {
  const reduced = useReducedMotion();

  return useMemo(() => {
    if (!reduced) return { fade, panel, collapse, popover };

    return {
      fade,
      panel: withoutMovement(panel),
      collapse: withoutMovement(collapse),
      popover: (side?: Side) => withoutMovement(popover(side)),
    };
  }, [reduced]);
}
