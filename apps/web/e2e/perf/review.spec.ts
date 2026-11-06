import { expect, test } from '@playwright/test';

import { open } from '../support/open';
import { best, measureScroll } from './support';

test('a five-hundred-file diff opens fast and its tree scrolls at frame rate', async ({
  page,
}) => {
  const started = Date.now();
  await open(page, '/design/perf');
  await expect(page.getByTestId('diff-demo')).toHaveAttribute(
    'data-files',
    '500',
  );
  await expect(
    page.locator('[data-testid="diff-file"] .diff-code-insert').first(),
  ).toBeVisible();
  const ready = Date.now() - started;
  console.log(`500-file diff ready in ${ready}ms`);
  expect(ready).toBeLessThan(8000);

  const tree = page.getByTestId('diff-tree-scroll');
  await tree.scrollIntoViewIfNeeded();
  await measureScroll(tree, 120);
  const passes = [
    await measureScroll(tree, 120),
    await measureScroll(tree, 120),
  ];
  console.log(
    `tree scroll: medians ${passes.map((p) => p.sort((a, b) => a - b)[Math.floor(p.length / 2)]?.toFixed(1)).join('/')}ms`,
  );
  expect(best(passes, 0.5)).toBeLessThan(45);
  expect(best(passes, 0.95)).toBeLessThan(150);

  // Switching files stays quick: the next file renders, tokens and all.
  const before = Date.now();
  await page.getByTestId('file-src/module41/file499.ts').click();
  await expect(page.getByTestId('diff-file')).toHaveAttribute(
    'data-path',
    'src/module41/file499.ts',
  );
  await expect(
    page
      .locator('[data-testid="diff-file"] .diff-code span[style*="color"]')
      .first(),
  ).toBeVisible();
  const switched = Date.now() - before;
  console.log(`file switch ${switched}ms`);
  expect(switched).toBeLessThan(2000);
});
