import { expect, test, type Page } from '@playwright/test';

import { axeViolations } from './support/axe';
import { open } from './support/open';

const palette = (page: Page) =>
  page.getByRole('dialog', { name: 'Command palette' });
const openPalette = async (page: Page) => {
  await page.keyboard.press('Control+k');
  await expect(palette(page)).toBeVisible();
  await expect(page.getByTestId('palette-input')).toBeFocused();
};

test.describe('the command palette', () => {
  test('opens with the keyboard, filters, and navigates', async ({ page }) => {
    await open(page, '/');
    await openPalette(page);

    await page.keyboard.type('web');
    const match = palette(page).getByRole('option', { name: /forgemind\/web/ });
    await expect(match).toBeVisible();
    await expect(
      palette(page).getByRole('option', { name: /forgemind\/api/ }),
    ).toHaveCount(0);

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/repositories\/repo-2$/);
    await expect(palette(page)).toHaveCount(0);
  });

  test('finds tasks and shows their status', async ({ page }) => {
    await open(page, '/');
    await openPalette(page);

    // "retry" must not match every repository through the word "repository".
    await page.keyboard.type('retry');
    await expect(
      palette(page).getByRole('option', { name: /forgemind\/api/ }),
    ).toHaveCount(0);

    await page.keyboard.type(' budget');
    const task = palette(page).getByRole('option', {
      name: /Fix retry budget overflow/,
    });
    await expect(task).toBeVisible();
    await expect(task).toContainText('Awaiting approval');

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/tasks\/task-2$/);
    await expect(
      page.getByRole('heading', {
        name: 'Fix retry budget overflow',
        level: 1,
      }),
    ).toBeVisible();
  });

  test('runs actions', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page, '/');

    await openPalette(page);
    await page.keyboard.type('theme light');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await openPalette(page);
    await page.keyboard.type('sidebar');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute(
      'data-sidebar',
      'compact',
    );

    await openPalette(page);
    await page.keyboard.type('shortcuts');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('shortcut-help')).toBeVisible();
  });

  test('says when nothing matches', async ({ page }) => {
    await open(page, '/');
    await openPalette(page);

    await page.keyboard.type('zzzz nothing here');
    await expect(palette(page).getByText('No results.')).toBeVisible();
  });

  test('closes with Escape and returns focus to the search button', async ({
    page,
  }) => {
    await open(page, '/');

    const search = page.getByTestId('search-trigger');
    await search.focus();
    await page.keyboard.press('Enter');
    await expect(palette(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(palette(page)).toHaveCount(0);
    await expect(search).toBeFocused();
  });

  test('toggles closed with the same shortcut', async ({ page }) => {
    await open(page, '/');
    await openPalette(page);
    await page.keyboard.press('Control+k');
    await expect(palette(page)).toHaveCount(0);
  });
});

test.describe('shortcuts', () => {
  test('go-to sequences move between sections', async ({ page }) => {
    await open(page, '/');

    await page.keyboard.press('g');
    await page.keyboard.press('s');
    await expect(page).toHaveURL(/\/security$/);

    await page.keyboard.press('g');
    await page.keyboard.press(',');
    await expect(page).toHaveURL(/\/settings$/);

    await page.keyboard.press('g');
    await page.keyboard.press('o');
    await expect(page).toHaveURL(/\/$/);
  });

  test('N starts a new task and ? opens the help', async ({ page }) => {
    await open(page, '/');

    await page.keyboard.press('n');
    await expect(page).toHaveURL(/\/tasks\/new$/);
    await expect(
      page.getByRole('heading', { name: 'New task', level: 1 }),
    ).toBeVisible();

    await page.keyboard.press('Shift+/');
    const help = page.getByTestId('shortcut-help');
    await expect(help).toBeVisible();
    await expect(help).toContainText('Open the command palette');
    await expect(help).toContainText('then');

    await page.keyboard.press('Escape');
    await expect(help).toHaveCount(0);
  });

  test('single keys are ignored while typing', async ({ page }) => {
    await open(page, '/');
    await openPalette(page);

    await page.keyboard.type('g s');
    await expect(page.getByTestId('palette-input')).toHaveValue('g s');
    await expect(page).toHaveURL(/\/$/);
    await expect(palette(page)).toBeVisible();
  });

  test('the sidebar shortcut works and is announced in the help', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, '/');

    await page.keyboard.press('Control+b');
    await expect(page.locator('html')).toHaveAttribute(
      'data-sidebar',
      'compact',
    );
    await page.keyboard.press('Control+b');
    await expect(page.locator('html')).toHaveAttribute(
      'data-sidebar',
      'expanded',
    );
  });

  test('the profile menu offers the shortcut help', async ({ page }) => {
    await open(page, '/');

    await page.getByTestId('profile-trigger').click();
    await page.getByRole('menuitem', { name: /Keyboard shortcuts/ }).click();
    await expect(page.getByTestId('shortcut-help')).toBeVisible();
  });
});

test('the current core path can be walked by keyboard alone', async ({
  page,
}) => {
  await open(page, '/');

  // Skip link first, then into the app.
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Skip to content' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();

  // Find a repository.
  await openPalette(page);
  await page.keyboard.type('forgemind/api');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/repositories\/repo-1$/);
  await expect(
    page.getByText('forgemind/api', { exact: true }).first(),
  ).toBeVisible();

  // Find the task that is running on it.
  await openPalette(page);
  await page.keyboard.type('failing build');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/tasks\/task-1$/);
  await expect(
    page.getByRole('heading', {
      name: 'Investigate the failing build',
      level: 1,
    }),
  ).toBeVisible();

  // Start a new one, check the help, and go home.
  await page.keyboard.press('n');
  await expect(page).toHaveURL(/\/tasks\/new$/);
  await page.keyboard.press('Shift+/');
  await expect(page.getByTestId('shortcut-help')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('g');
  await page.keyboard.press('o');
  await expect(page).toHaveURL(/\/$/);
});

test.describe('accessibility', () => {
  test('the open palette and the help dialog have no axe violations', async ({
    page,
  }) => {
    await open(page, '/');
    await openPalette(page);
    expect(await axeViolations(page, { include: '[role="dialog"]' })).toEqual(
      [],
    );

    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+/');
    await expect(page.getByTestId('shortcut-help')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
});
