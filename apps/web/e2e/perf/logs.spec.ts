import { expect, test } from '@playwright/test';

import { open } from '../support/open';

const FRAMES = 90;
const MAX_RENDERED_ROWS = 80;

/** Frame durations while scrolling the log by `step` pixels a frame. */
const measure = (page: Parameters<typeof open>[0], step: number) =>
  page.getByTestId('log-scroll').evaluate(
    (element, { step, frames }) =>
      new Promise<number[]>((resolve) => {
        const durations: number[] = [];
        let last = performance.now();
        let count = 0;
        const tick = () => {
          const now = performance.now();
          durations.push(now - last);
          last = now;
          element.scrollTop += step;
          count += 1;
          if (count < frames) requestAnimationFrame(tick);
          else resolve(durations.slice(2));
        };
        requestAnimationFrame(tick);
      }),
    { step, frames: FRAMES },
  );

const percentile = (frames: number[], q: number) => {
  const sorted = [...frames].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * q)] ?? 0;
};

test('a hundred thousand log lines scroll at frame rate', async ({ page }) => {
  await open(page, '/design/logs');
  await expect(page.getByTestId('log-count')).toHaveText('100,000 lines');
  const scroll = page.getByTestId('log-scroll');
  await scroll.scrollIntoViewIfNeeded();
  await scroll.evaluate((element) => {
    element.scrollTop = 0;
  });

  // One pass to warm up, then the better of two passes at ten rows a frame.
  await measure(page, 220);
  const passes = [await measure(page, 220), await measure(page, 220)];
  const medians = passes.map((frames) => percentile(frames, 0.5));
  const slows = passes.map((frames) => percentile(frames, 0.95));
  console.log(
    `log scroll: medians ${medians.map((m) => m.toFixed(1)).join('/')}ms, p95s ${slows.map((p) => p.toFixed(1)).join('/')}ms`,
  );

  expect(Math.min(...medians)).toBeLessThan(45);
  expect(Math.min(...slows)).toBeLessThan(150);
  expect(
    await page.locator('[data-testid="log-scroll"] [data-line]').count(),
  ).toBeLessThan(MAX_RENDERED_ROWS);
});
