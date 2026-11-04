import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { open } from './support/open';

const sections = [
  { path: '/', name: 'Overview' },
  { path: '/tasks', name: 'Tasks' },
  { path: '/repositories', name: 'Repositories' },
  { path: '/settings', name: 'Settings' },
];

const urlOf = (path: string) => new RegExp(`${path === '/' ? '' : path}/?$`);

const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const palette = (page: Page) =>
  page.getByRole('dialog', { name: 'Command palette' });
const search = (page: Page) =>
  page.getByRole('combobox', { name: 'Search commands' });
const drawer = (page: Page) => page.getByRole('dialog', { name: 'Navigation' });

async function expectNoAxeViolations(page: Page, label: string) {
  // Let entrances finish, so axe never judges a half-faded overlay.
  await page.waitForFunction(() =>
    document.getAnimations().every(({ playState }) => playState !== 'running'),
  );

  const { violations } = await new AxeBuilder({ page }).analyze();
  const summary = violations.map(
    ({ id, impact, nodes }) =>
      `${id} (${impact}): ${nodes.map(({ target }) => target.join(' ')).join(', ')}`,
  );

  expect(summary, label).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
});

test.describe('sidebar', () => {
  test('marks the current section and moves between them', async ({ page }) => {
    await open(page, '/');
    const nav = mainNav(page);

    await expect(nav.getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    for (const { path, name } of sections.slice(1)) {
      await nav.getByRole('link', { name }).click();

      await expect(page).toHaveURL(urlOf(path));
      await expect(page).toHaveTitle(`${name} | ForgeMind`);
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
      await expect(nav.locator('[aria-current="page"]')).toHaveText(name);
    }
  });

  test('the logo leads back to the overview', async ({ page }) => {
    await open(page, '/tasks');

    await page.getByRole('link', { name: 'ForgeMind' }).click();

    await expect(page).toHaveURL(urlOf('/'));
    await expect(
      page.getByRole('heading', { level: 1, name: 'Overview' }),
    ).toBeVisible();
  });

  test('the skip link jumps past the navigation', async ({ page }) => {
    await open(page, '/settings');

    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();

    await page.keyboard.press('Enter');
    await expect(page.locator('main')).toBeFocused();

    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() =>
        Boolean(document.activeElement?.closest('main')),
      ),
    ).toBe(true);
  });

  test('an unknown address shows the not found page', async ({ page }) => {
    const response = await page.goto('/no-such-page');

    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Back to overview' }).click();
    await expect(page).toHaveURL(urlOf('/'));
  });
});

test.describe('accessibility', () => {
  for (const theme of ['dark', 'light'] as const) {
    test(`every section has no axe violations in the ${theme} theme`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });

      for (const { path } of sections) {
        await open(page, path);
        await expectNoAxeViolations(page, `${path} ${theme}`);
      }
    });

    test(`the command palette has no axe violations in the ${theme} theme`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });
      await open(page, '/');

      await page.keyboard.press('Control+k');
      await expect(palette(page)).toBeVisible();
      await expectNoAxeViolations(page, `palette ${theme}`);

      await search(page).fill('zzz');
      await expect(palette(page).getByRole('status')).toBeVisible();
      await expectNoAxeViolations(page, `palette with no results ${theme}`);
    });
  }
});

test.describe('command palette', () => {
  test('opens with Ctrl+K or ⌘K, and the same keys close it', async ({
    page,
  }) => {
    await open(page, '/');

    await page.keyboard.press('Control+k');
    await expect(palette(page)).toBeVisible();
    await expect(search(page)).toBeFocused();

    await page.keyboard.press('Control+k');
    await expect(palette(page)).toBeHidden();

    await page.keyboard.press('Meta+k');
    await expect(palette(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(palette(page)).toBeHidden();
  });

  test('the search button opens it and gets focus back', async ({ page }) => {
    await open(page, '/');
    const button = page.getByRole('button', { name: 'Search' });

    await expect(button).toHaveAttribute('aria-keyshortcuts', /Control\+K/);
    await button.click();
    await expect(search(page)).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(palette(page)).toBeHidden();
    await expect(button).toBeFocused();
  });

  test('moves with the arrow keys and wraps at the ends', async ({ page }) => {
    await open(page, '/');
    await page.keyboard.press('Control+k');

    const input = search(page);
    const options = palette(page).getByRole('option');
    const activeId = () => input.getAttribute('aria-activedescendant');

    await expect(options.first()).toHaveAttribute('aria-selected', 'true');
    expect(await activeId()).toBe(await options.first().getAttribute('id'));

    await input.press('ArrowDown');
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(options.first()).toHaveAttribute('aria-selected', 'false');

    await input.press('ArrowUp');
    await input.press('ArrowUp');
    await expect(options.last()).toHaveAttribute('aria-selected', 'true');
    expect(await activeId()).toBe(await options.last().getAttribute('id'));

    await input.press('ArrowDown');
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  });

  test('filters as you type and runs the active command with Enter', async ({
    page,
  }) => {
    await open(page, '/');
    await page.keyboard.press('Control+k');

    await search(page).fill('repo');
    await expect(palette(page).getByRole('option')).toHaveText([
      'Repositories',
    ]);

    await search(page).press('Enter');
    await expect(palette(page)).toBeHidden();
    await expect(page).toHaveURL(urlOf('/repositories'));
    await expect(
      page.getByRole('heading', { level: 1, name: 'Repositories' }),
    ).toBeVisible();
  });

  test('matches the other words people use for a page', async ({ page }) => {
    await open(page, '/');
    await page.keyboard.press('Control+k');

    await search(page).fill('runs');
    await expect(palette(page).getByRole('option')).toHaveText(['Tasks']);
  });

  test('says so when nothing matches', async ({ page }) => {
    await open(page, '/');
    await page.keyboard.press('Control+k');

    await search(page).fill('zzz');
    await expect(palette(page).getByRole('status')).toHaveText(
      'No results for “zzz”',
    );
    await expect(search(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(palette(page).getByRole('listbox')).toHaveCount(0);

    await search(page).press('Enter');
    await expect(palette(page)).toBeVisible();
  });

  test('runs a command on click', async ({ page }) => {
    await open(page, '/');
    await page.keyboard.press('Control+k');

    await palette(page).getByRole('option', { name: 'Settings' }).click();

    await expect(palette(page)).toBeHidden();
    await expect(page).toHaveURL(urlOf('/settings'));
  });

  test('switches the theme and marks the one in use', async ({ page }) => {
    await open(page, '/');
    await page.keyboard.press('Control+k');

    await search(page).fill('light');
    await search(page).press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.keyboard.press('Control+k');
    await search(page).fill('theme');
    await expect(
      palette(page).getByRole('option', { name: 'Use light theme (current)' }),
    ).toBeVisible();
  });

  test('starts fresh each time it opens', async ({ page }) => {
    await open(page, '/');
    await page.keyboard.press('Control+k');
    await search(page).fill('repo');
    await page.keyboard.press('Escape');
    await expect(palette(page)).toBeHidden();

    await page.keyboard.press('Control+k');
    await expect(search(page)).toHaveValue('');
  });
});

test.describe('on a narrow screen', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the sidebar becomes a drawer that closes on navigation', async ({
    page,
  }) => {
    await open(page, '/');
    await expect(mainNav(page)).toBeHidden();

    const menu = page.getByRole('button', { name: 'Open navigation' });
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await menu.click();
    await expect(drawer(page)).toBeVisible();
    await expectNoAxeViolations(page, 'navigation drawer');

    await drawer(page).getByRole('link', { name: 'Tasks' }).click();

    await expect(page).toHaveURL(urlOf('/tasks'));
    await expect(drawer(page)).toBeHidden();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Tasks' }),
    ).toBeVisible();
  });

  test('the drawer closes on Escape and returns focus', async ({ page }) => {
    await open(page, '/');
    const menu = page.getByRole('button', { name: 'Open navigation' });

    await menu.click();
    await expect(drawer(page)).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(drawer(page)).toBeHidden();
    await expect(menu).toBeFocused();
  });

  test('search in the drawer hands over to the command palette', async ({
    page,
  }) => {
    await open(page, '/');

    await page.getByRole('button', { name: 'Open navigation' }).click();
    await drawer(page).getByRole('button', { name: 'Search' }).click();

    await expect(drawer(page)).toBeHidden();
    await expect(palette(page)).toBeVisible();
    await expect(search(page)).toBeFocused();
  });

  test('every section has no axe violations', async ({ page }) => {
    for (const { path } of sections) {
      await open(page, path);
      await expectNoAxeViolations(page, `${path} narrow`);
    }
  });
});

test('nothing in the shell keeps moving once the page has settled', async ({
  page,
}) => {
  await open(page, '/');
  await page.getByRole('link', { name: 'Tasks' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Tasks' }),
  ).toBeVisible();

  await page.waitForFunction(() =>
    document.getAnimations().every(({ playState }) => playState !== 'running'),
  );
});
