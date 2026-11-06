import type { EventTemplate, Step } from './scenarios';

/*
 * Plays a scenario against a run. Steps already in the past are emitted at
 * once with their historical timestamps; the rest are scheduled, scaled by
 * speed. Infinity plays everything immediately.
 */

export type Player = { stop: () => void; done: boolean };

type PlayOptions = {
  speed: number;
  /** How far into the scenario the run already is. */
  elapsedMs: number;
  startedAt: Date;
  emit: (template: EventTemplate, at?: Date) => void;
  onDone?: () => void;
};

export function play(steps: Step[], options: PlayOptions): Player {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const player: Player = {
    done: false,
    stop() {
      player.done = true;
      timers.forEach(clearTimeout);
    },
  };

  const pending: Step[] = [];

  for (const step of steps) {
    if (options.speed === Infinity || step.at <= options.elapsedMs) {
      options.emit(step.event, new Date(options.startedAt.getTime() + step.at));
    } else {
      pending.push(step);
    }
  }

  if (pending.length === 0) {
    player.done = true;
    options.onDone?.();
    return player;
  }

  pending.forEach((step, index) => {
    const timer = setTimeout(
      () => {
        if (player.done) return;
        options.emit(step.event);
        if (index === pending.length - 1) {
          player.done = true;
          options.onDone?.();
        }
      },
      (step.at - options.elapsedMs) / options.speed,
    );
    timer.unref?.();
    timers.push(timer);
  });

  return player;
}
