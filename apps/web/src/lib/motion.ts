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

const enter = (duration: number): Transition => ({
  duration,
  ease: easings.enter,
});

const exit = (duration: number): Transition => ({
  duration,
  ease: easings.exit,
});

export const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: enter(durations.fast) },
  exit: { opacity: 0, transition: exit(durations.fast) },
} as const satisfies Variants;

/** Dialogs and overlays settle in from slightly smaller. */
export const panel = {
  initial: { opacity: 0, scale: movement.scale },
  animate: { opacity: 1, scale: 1, transition: enter(durations.slow) },
  exit: { opacity: 0, scale: movement.scale, transition: exit(durations.base) },
} as const satisfies Variants;

export type Side = 'top' | 'right' | 'bottom' | 'left';

/** Popovers rise out of the control that opened them. */
export function popover(side: Side = 'bottom') {
  const offset = {
    top: { y: movement.shift },
    right: { x: -movement.shift },
    bottom: { y: -movement.shift },
    left: { x: movement.shift },
  }[side];

  return {
    initial: { opacity: 0, ...offset },
    animate: { opacity: 1, x: 0, y: 0, transition: enter(durations.base) },
    exit: { opacity: 0, ...offset, transition: exit(durations.fast) },
  } satisfies Variants;
}

/** Expandable panels open to their natural height. */
export const collapse = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1, transition: transitions.base },
  exit: { height: 0, opacity: 0, transition: transitions.base },
} as const satisfies Variants;

const MOVEMENT = new Set(['x', 'y', 'scale', 'rotate', 'height', 'width']);

/**
 * The same presets with every movement removed, for reduced motion. Only the
 * fades remain, so nothing pops for even a single frame before settling.
 */
export function withoutMovement<T extends Variants>(variants: T): T {
  return Object.fromEntries(
    Object.entries(variants).map(([name, state]) => [
      name,
      typeof state === 'function'
        ? state
        : Object.fromEntries(
            Object.entries(state).filter(([key]) => !MOVEMENT.has(key)),
          ),
    ]),
  ) as T;
}
