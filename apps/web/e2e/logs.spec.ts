import { expect, test, type Page } from '@playwright/test';

import { axeViolations } from './support/axe';
import { open } from './support/open';

const PAGE = '/design/logs';

const total = async (page: Page) =>
  Number(
    ((await page.getByTestId('log-lines-count').textContent()) ?? '0').replace(
      /,/g,
      '',
    ),
  );

const lastVisibleLine = (page: Page) =>
  page
    .locator('[data-testid="log-scroll"] [data-line]')
    .evaluateAll((rows) =>
      Math.max(...rows.map((row) => Number((row as HTMLElement).dataset.line))),
    );

test.describe('the log viewer', () => {
  test('renders only the rows in view of a hundred thousand lines, newest first in view', async ({
    page,
  }) => {
    await open(page, PAGE);
    await expect(page.getByTestId('log-lines-count')).toHaveText('100,000');
    await expect(page.getByTestId('log-count')).toHaveText('100,000 lines');
    expect(
      await page.locator('[data-testid="log-scroll"] [data-line]').count(),
    ).toBeLessThan(80);
    await expect(page.locator('[data-line="100000"]')).toBeVisible();
  });

  test('scrolling up pauses follow mode; Follow and End pick it up again', async ({
    page,
  }) => {
    await open(page, PAGE);
    await page.getByTestId('log-simulate').click();
    await expect.poll(() => total(page)).toBeGreaterThan(100_000);

    const follow = page.getByTestId('log-follow');
    const scroll = page.getByTestId('log-scroll');
    await expect(follow).toHaveAttribute('data-follow', 'true');
    await expect
      .poll(async () => (await total(page)) - (await lastVisibleLine(page)))
      .toBeLessThanOrEqual(5);

    await scroll.evaluate((element) => {
      element.scrollTop -= 2000;
    });
    await expect(follow).toHaveAttribute('data-follow', 'false');
    const pausedAt = await scroll.evaluate((element) => element.scrollTop);
    await page.waitForTimeout(600);
    expect(await scroll.evaluate((element) => element.scrollTop)).toBe(
      pausedAt,
    );

    await follow.click();
    await expect(follow).toHaveAttribute('data-follow', 'true');
    await expect
      .poll(async () => (await total(page)) - (await lastVisibleLine(page)))
      .toBeLessThanOrEqual(5);

    await scroll.evaluate((element) => {
      element.scrollTop -= 2000;
    });
    await expect(follow).toHaveAttribute('data-follow', 'false');
    await scroll.focus();
    await page.keyboard.press('End');
    await expect(follow).toHaveAttribute('data-follow', 'true');
  });

  test('search counts, steps through and highlights matches, and can hide the rest', async ({
    page,
  }) => {
    await open(page, PAGE);
    await page.getByTestId('log-search').fill('ENOMEM');
    const count = page.getByTestId('log-match-count');
    await expect(count).toHaveText(/^1 of \d+$/);
    const matches = Number(
      ((await count.textContent()) ?? '').split(' of ')[1],
    );
    expect(matches).toBeGreaterThan(10);

    await expect(page.locator('[data-active]')).toHaveCount(1);
    await expect(page.locator('[data-active] mark').first()).toHaveText(
      'ENOMEM',
    );
    await page.getByRole('button', { name: 'Next match' }).click();
    await expect(count).toHaveText(`2 of ${matches}`);
    await page.getByTestId('log-search').press('Shift+Enter');
    await expect(count).toHaveText(`1 of ${matches}`);

    await page.getByTestId('log-matches-only').click();
    await expect(page.getByTestId('log-count')).toHaveText(
      `${matches.toLocaleString('en-US')} of 100,000 lines`,
    );
    expect(
      await page
        .locator('[data-testid="log-scroll"] [data-line]:not([data-match])')
        .count(),
    ).toBe(0);
  });

  test('filters by source and level', async ({ page }) => {
    await open(page, PAGE);
    const stdout = page.getByTestId('log-source-stdout');
    await stdout.click();
    await expect(stdout).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('log-count')).toHaveText(
      / of 100,000 lines$/,
    );
    expect(
      await page
        .locator('[data-testid="log-scroll"] [data-source="stdout"]')
        .count(),
    ).toBe(0);
    await stdout.click();
    await expect(stdout).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('combobox').filter({ hasText: 'All levels' }).click();
    await page.getByRole('option', { name: 'Errors only' }).click();
    await expect(page.getByTestId('log-count')).toHaveText(
      / of 100,000 lines$/,
    );
    expect(
      await page
        .locator(
          '[data-testid="log-scroll"] [data-line]:not([data-level="error"])',
        )
        .count(),
    ).toBe(0);
  });

  test('links to a line and copies what is shown', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page, `${PAGE}#L500`);
    const target = page.locator('[data-line="500"]');
    await expect(target).toHaveAttribute('data-selected', 'true');
    await expect(target).toBeVisible();
    await expect(page.getByTestId('log-follow')).toHaveAttribute(
      'data-follow',
      'false',
    );

    await page.locator('[data-line="503"] a').click();
    await expect(page).toHaveURL(/#L503$/);
    await page
      .getByRole('button', { name: 'Copy link to the selected line' })
      .click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
      /\/design\/logs#L503$/,
    );

    await page.getByTestId('log-search').fill('ENOMEM');
    await page.getByTestId('log-matches-only').click();
    await page.getByRole('button', { name: 'Copy shown lines' }).click();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text.length).toBeGreaterThan(0);
    expect(text.split('\n').every((line) => line.includes('ENOMEM'))).toBe(
      true,
    );
  });

  test('has no axe violations', async ({ page }) => {
    await open(page, PAGE);
    expect(await axeViolations(page)).toEqual([]);
  });
});
