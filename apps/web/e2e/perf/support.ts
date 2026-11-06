import type { Locator } from '@playwright/test';

/*
 * Frame durations while scrolling an element by `step` pixels a frame, from
 * the top. The element must have room for the whole distance: a scroller
 * that reaches its end stops firing scroll events and painting, and the
 * remaining frames would measure an idle page.
 */
export const measureScroll = (element: Locator, step: number, frames = 90) =>
  element.evaluate(
    (node, { step, frames }) =>
      new Promise<number[]>((resolve, reject) => {
        node.scrollTop = 0;
        const durations: number[] = [];
        let last = performance.now();
        let count = 0;
        const tick = () => {
          const now = performance.now();
          durations.push(now - last);
          last = now;
          node.scrollTop += step;
          count += 1;
          if (count < frames) {
            requestAnimationFrame(tick);
            return;
          }
          const travelled = node.scrollTop;
          if (travelled < step * (frames - 1)) {
            reject(
              new Error(
                `scroller ran out of room: ${travelled}px of ${step * frames}px`,
              ),
            );
            return;
          }
          resolve(durations.slice(2));
        };
        requestAnimationFrame(tick);
      }),
    { step, frames },
  );

/** Frame durations while the page just keeps rendering, for a given time. */
export const measureIdle = (element: Locator, ms: number) =>
  element.evaluate(
    (_node, { ms }) =>
      new Promise<number[]>((resolve) => {
        const durations: number[] = [];
        const start = performance.now();
        let last = start;
        const tick = () => {
          const now = performance.now();
          durations.push(now - last);
          last = now;
          if (now - start < ms) requestAnimationFrame(tick);
          else resolve(durations.slice(2));
        };
        requestAnimationFrame(tick);
      }),
    { ms },
  );

export const percentile = (frames: number[], q: number) => {
  const sorted = [...frames].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * q)] ?? 0;
};

export const best = (passes: number[][], q: number) =>
  Math.min(...passes.map((frames) => percentile(frames, q)));
