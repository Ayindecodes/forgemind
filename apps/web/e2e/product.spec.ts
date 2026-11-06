import { expect, test, type Page } from '@playwright/test';

import { statusValues } from '../src/components/ui/status';
import { open } from './support/open';

const PAGE = '/design/components';

const MAX_RENDERED_ROWS = 60;

const renderedRows = (page: Page) =>
  page.locator('[data-testid="table-scroll"] tbody tr').count();

test.describe('status indicators', () => {
  test('show an icon and a label for every status', async ({ page }) => {
    await open(page, PAGE);

    const list = page.getByTestId('status-list');
    const icons = new Set<string>();

    for (const status of statusValues) {
      const item = list.locator(`[data-status="${status}"]`);
      await expect(item).toBeVisible();
      await expect(item.locator('svg')).toHaveCount(1);
      await expect(item).not.toHaveText('');

      icons.add(await item.locator('svg').innerHTML());
    }

    expect(icons.size).toBe(statusValues.length);
  });

  test('keep the label for screen readers when the icon is alone', async ({
    page,
  }) => {
    await open(page, PAGE);

    const item = page
      .getByTestId('status-icons')
      .locator('[data-status="failed"]');
    const label = item.locator('span').last();

    await expect(label).toHaveText('Failed');
    await expect(label).toHaveClass(/sr-only/);
    await expect(item).toContainText('Failed');
  });
});

test.describe('metrics', () => {
  test('use tabular figures and describe a change in words', async ({
    page,
  }) => {
    await open(page, PAGE);

    const metric = page.getByTestId('metric-tokens');
    const value = metric.locator('.tabular-nums').first();
    expect(
      await value.evaluate(
        (element) => getComputedStyle(element).fontVariantNumeric,
      ),
    ).toContain('tabular-nums');

    await expect(metric).toContainText('up');
    await expect(metric).toContainText('+12.5%');
    await expect(page.getByText('Estimate')).toBeVisible();
    await expect(
      page.getByText('The provider does not report cost.'),
    ).toBeVisible();
  });
});

test.describe('data table', () => {
  test('renders only the visible rows of ten thousand', async ({ page }) => {
    await open(page, PAGE);

    await expect(page.getByTestId('table-footer')).toHaveText('10,000 rows');
    expect(await renderedRows(page)).toBeLessThan(MAX_RENDERED_ROWS);

    const scroll = page.getByTestId('table-scroll');
    await scroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });

    await expect(page.locator('tbody tr[aria-rowindex="10000"]')).toBeVisible();
    expect(await renderedRows(page)).toBeLessThan(MAX_RENDERED_ROWS);
  });

  test('sorts from the keyboard and announces the direction', async ({
    page,
  }) => {
    await open(page, PAGE);

    const header = page.getByRole('columnheader', { name: 'Duration' });
    await expect(header).toHaveAttribute('aria-sort', 'none');

    await header.getByRole('button').focus();
    await page.keyboard.press('Enter');
    await expect(header).toHaveAttribute('aria-sort', 'ascending');

    const first = page.locator('tbody tr[aria-rowindex="1"] td').nth(3);
    await expect(first).toHaveText('0ms');

    await page.keyboard.press('Enter');
    await expect(header).toHaveAttribute('aria-sort', 'descending');
    await expect(first).not.toHaveText('0ms');
  });

  test('shows loading and empty states', async ({ page }) => {
    await open(page, PAGE);

    await page.getByTestId('table-mode-loading').click();
    await expect(
      page.getByRole('table', { name: 'Demo engineering tasks' }),
    ).toHaveAttribute('aria-busy', 'true');

    await page.getByTestId('table-mode-empty').click();
    await expect(page.getByText('No tasks yet')).toBeVisible();
    await expect(page.getByTestId('table-footer')).toHaveText('0 rows');
  });
});

test.describe('code block', () => {
  test('is highlighted, focusable and copies its exact text', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page, PAGE);

    const block = page.getByRole('figure').filter({ hasText: 'verify.ts' });
    const pre = block.locator('pre');

    await expect(pre).toHaveAttribute('tabindex', '0');

    const colors = await pre
      .locator('[data-line="4"] span[style]')
      .evaluateAll(
        (spans) =>
          new Set(spans.map((span) => span.getAttribute('style'))).size,
      );
    expect(colors).toBeGreaterThan(1);

    const gutter = pre.locator('[data-line="1"] span').first();
    await expect(gutter).toHaveAttribute('aria-hidden', 'true');
    expect(
      await gutter.evaluate((element) => getComputedStyle(element).userSelect),
    ).toBe('none');

    await block.getByRole('button', { name: 'Copy code' }).click();
    await expect(block.getByRole('button', { name: 'Copied' })).toBeVisible();
    await expect(block.getByRole('status')).toHaveText('Copied to clipboard');

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied.startsWith("import { retry } from './retry';")).toBe(true);
    expect(copied).not.toMatch(/^\s*1\s/m);
  });

  test('marks the highlighted lines', async ({ page }) => {
    await open(page, PAGE);

    const line = page.locator('[data-line="11"]');
    expect(
      await line.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ).not.toBe('rgba(0, 0, 0, 0)');
  });
});

test.describe('empty and error states', () => {
  test('announce errors and retry with a busy button', async ({ page }) => {
    await open(page, PAGE);

    const error = page
      .getByRole('alert')
      .filter({ hasText: 'Analysis failed' });
    await expect(error).toBeVisible();

    await error.getByText('Details').click();
    await expect(error.getByText(/MemoryError/)).toBeVisible();

    const retry = error.getByRole('button', { name: 'Try again' });
    await retry.click();
    await expect(retry).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByTestId('retry-count')).toHaveText('Retried 1');
    await expect(retry).not.toHaveAttribute('aria-busy', 'true');
  });

  test('offer a way forward', async ({ page }) => {
    await open(page, PAGE);

    await expect(
      page.getByRole('button', { name: 'Connect repository' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Request access' }),
    ).toBeVisible();
  });
});
