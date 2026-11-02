import type { Transition, Variants } from 'motion/react';

/*
 * Presets for the Motion library. They mirror the duration and easing tokens
 * and the movement amounts in motion.css; motion.test.ts fails if they drift.
 * Components use these presets and never write their own timing.
 */

export const durations = {
  /** Small interactions: hover, press, status changes. */
  fast: 0.12,
  /** Popovers, menus, expanding panels. */
  base: 0.18,
  /** Dialogs and overlays. */
  slow: 0.28,
} as const;

type Bezier = [number, number, number, number];

export const easings = {
  standard: [0.2, 0, 0, 1],
  enter: [0, 0, 0.2, 1],
  exit: [0.4, 0, 1, 1],
} as const satisfies Record<string, Bezier>;

export const movement = {
  scale: 0.96,
  shift: 4,
  press: 0.98,
} as const;

export const transitions = {
  fast: { duration: durations.fast, ease: easings.standard },
  base: { duration: durations.base, ease: easings.standard },
  slow: { duration: durations.slow, ease: easings.standard },
} as const satisfies Record<string, Transition>;
