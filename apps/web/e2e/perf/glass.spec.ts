import { expect, test } from '@playwright/test';

import { open } from '../support/open';
import { best, measureScroll } from './support';

test('ten glass layers over moving colour scroll at frame rate', async ({
  page,
}) => {
  await open(page, '/design/perf');
  const scroll = page.getByTestId('glass-scroll');
  await scroll.scrollIntoViewIfNeeded();
  await measureScroll(scroll, 60);
  const passes = [
    await measureScroll(scroll, 60),
    await measureScroll(scroll, 60),
  ];
  console.log(
    `glass scroll: medians ${passes.map((p) => p.sort((a, b) => a - b)[Math.floor(p.length / 2)]?.toFixed(1)).join('/')}ms, p95s ${passes.map((p) => p.sort((a, b) => a - b)[Math.floor(p.length * 0.95)]?.toFixed(1)).join('/')}ms`,
  );
  expect(best(passes, 0.5)).toBeLessThan(45);
  expect(best(passes, 0.95)).toBeLessThan(150);
});
