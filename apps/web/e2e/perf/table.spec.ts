import { expect, test } from '@playwright/test';

import { open } from '../support/open';

const PAGE = '/design/components';
const MAX_RENDERED_ROWS = 60;
const FRAMES = 90;

/** Frame durations while scrolling the table by `step` pixels a frame. */
const measure = (page: Parameters<typeof open>[0], step: number) =>
  page.getByTestId('table-scroll').evaluate(
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

test('a ten-thousand-row table scrolls at frame rate', async ({ page }) => {
  await open(page, PAGE);
  await expect(page.getByTestId('table-footer')).toHaveText('10,000 rows');
  await page.getByTestId('table-scroll').scrollIntoViewIfNeeded();

  // One pass to warm up, then the better of two measured passes. This checks
  // what the table can do, so a one-off stall from the machine should not
  // count against it.
  await measure(page, 360);
  const passes = [await measure(page, 360), await measure(page, 360)]; // ten rows a frame
  const medians = passes.map((frames) => percentile(frames, 0.5));
  const slows = passes.map((frames) => percentile(frames, 0.95));
  const median = Math.min(...medians);
  const slow = Math.min(...slows);
  console.log(
    `table scroll: medians ${medians.map((m) => m.toFixed(1)).join('/')}ms, p95s ${slows.map((p) => p.toFixed(1)).join('/')}ms`,
  );

  // Three frames at 60Hz for the typical frame. The broken states this guards
  // against measured 69ms (rows re-rendering twice a frame) and far worse
  // (rows not virtualized at all).
  expect(median).toBeLessThan(45);
  expect(slow).toBeLessThan(150);
  expect(
    await page.locator('[data-testid="table-scroll"] tbody tr').count(),
  ).toBeLessThan(MAX_RENDERED_ROWS);
});
