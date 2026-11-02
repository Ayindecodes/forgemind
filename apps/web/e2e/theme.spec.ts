import { expect, test, type Page } from '@playwright/test';

import { open } from './support/open';

const STORAGE_KEY = 'forgemind-theme';

const DARK_CANVAS = 'rgb(11, 13, 16)';
const LIGHT_CANVAS = 'rgb(250, 249, 247)';

declare global {
  interface Window {
    themeAtFirstContent?: string | null;
    themeChanges: (string | null)[];
  }
}

const theme = (page: Page) => page.locator('html');

const canvasColor = (page: Page) =>
  page.evaluate(
    () => getComputedStyle(document.documentElement).backgroundColor,
  );

const chooseTheme = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Theme' }).getByText(name).click();

function failOnPageErrors(page: Page) {
  const errors: string[] = [];

  page.on('pageerror', ({ message }) => errors.push(message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  return errors;
}

test.describe('theme selection', () => {
  test('follows the system theme, including live changes', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await open(page, '/design');

    await expect(theme(page)).toHaveAttribute('data-theme', 'light');
    expect(await canvasColor(page)).toBe(LIGHT_CANVAS);

    await page.emulateMedia({ colorScheme: 'dark' });

    await expect(theme(page)).toHaveAttribute('data-theme', 'dark');
    expect(await canvasColor(page)).toBe(DARK_CANVAS);
  });

  test('applies a saved theme before any content exists', async ({ page }) => {
    const errors = failOnPageErrors(page);

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript((key) => {
      localStorage.setItem(key, 'light');
      window.themeChanges = [];

      new MutationObserver((mutations) => {
        const root = document.documentElement;

        if (document.body && window.themeAtFirstContent === undefined) {
          window.themeAtFirstContent = root.getAttribute('data-theme');
        }

        for (const { attributeName, oldValue, target } of mutations) {
          if (attributeName !== 'data-theme' || target !== root) continue;

          const value = root.getAttribute('data-theme');
          if (document.body && oldValue !== value) {
            window.themeChanges.push(value);
          }
        }
      }).observe(document, {
        attributes: true,
        attributeFilter: ['data-theme'],
        attributeOldValue: true,
        childList: true,
        subtree: true,
      });
    }, STORAGE_KEY);

    await open(page, '/design');
    await expect(page.getByRole('radio', { name: 'Light' })).toBeChecked();

    expect(await page.evaluate(() => window.themeAtFirstContent)).toBe('light');
    expect(await page.evaluate(() => window.themeChanges)).toEqual([]);
    expect(await canvasColor(page)).toBe(LIGHT_CANVAS);
    expect(errors).toEqual([]);
  });

  test('ignores an invalid saved value', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.addInitScript(
      (key) => localStorage.setItem(key, 'sepia'),
      STORAGE_KEY,
    );
    await open(page, '/design');

    await expect(theme(page)).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('radio', { name: 'System' })).toBeChecked();
  });

  test('keeps a chosen theme across a reload', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page, '/design');

    await chooseTheme(page, 'Light');
    await expect(theme(page)).toHaveAttribute('data-theme', 'light');

    await page.reload();

    await expect(theme(page)).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('radio', { name: 'Light' })).toBeChecked();
  });

  test('returning to System follows the system theme again', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page, '/design');

    await chooseTheme(page, 'Light');
    await chooseTheme(page, 'System');

    await expect(theme(page)).toHaveAttribute('data-theme', 'dark');
  });

  test('syncs a choice to other open tabs', async ({ context }) => {
    const first = await context.newPage();
    const second = await context.newPage();

    await first.emulateMedia({ colorScheme: 'dark' });
    await second.emulateMedia({ colorScheme: 'dark' });
    await open(first, '/design');
    await open(second, '/design');

    await chooseTheme(first, 'Light');

    await expect(theme(second)).toHaveAttribute('data-theme', 'light');
    await expect(second.getByRole('radio', { name: 'Light' })).toBeChecked();
  });

  test('still works when storage is blocked', async ({ page }) => {
    const errors = failOnPageErrors(page);

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('Blocked', 'SecurityError');
        },
      });
    });
    await open(page, '/design');

    await expect(theme(page)).toHaveAttribute('data-theme', 'dark');

    await chooseTheme(page, 'Light');

    await expect(theme(page)).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('radio', { name: 'Light' })).toBeChecked();
    expect(errors).toEqual([]);
  });
});

test('the design page reports no contrast failures', async ({ page }) => {
  await open(page, '/design');

  await expect(
    page.getByText(/contrast pairs checked, 0 below AA/),
  ).toBeVisible();
  await expect(page.getByRole('cell', { name: /^Fail/ })).toHaveCount(0);
});
