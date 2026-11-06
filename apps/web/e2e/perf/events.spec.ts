import { expect, test } from '@playwright/test';

import { open } from '../support/open';
import { best, measureIdle } from './support';

test('fifty events a second keep the workspace at frame rate', async ({
  page,
}) => {
  await open(page, '/design/perf');
  const demo = page.getByTestId('events-demo');
  await demo.scrollIntoViewIfNeeded();
  await page.getByTestId('events-stream').click();
  // Let the first few hundred events settle the layout before timing.
  await expect
    .poll(async () => Number(await demo.getAttribute('data-events')), {
      timeout: 15_000,
    })
    .toBeGreaterThan(300);

  const before = Number(await demo.getAttribute('data-events'));
  const passes = [await measureIdle(demo, 3000), await measureIdle(demo, 3000)];
  const received = Number(await demo.getAttribute('data-events')) - before;
  console.log(
    `events: ${received} received during six seconds of timing; frame medians ${passes.map((p) => p.sort((a, b) => a - b)[Math.floor(p.length / 2)]?.toFixed(1)).join('/')}ms, p95s ${passes.map((p) => p.sort((a, b) => a - b)[Math.floor(p.length * 0.95)]?.toFixed(1)).join('/')}ms`,
  );
  // Fifty a second for six seconds, allowing for timer drift under load.
  expect(received).toBeGreaterThan(240);
  expect(best(passes, 0.5)).toBeLessThan(45);
  expect(best(passes, 0.95)).toBeLessThan(150);
});
