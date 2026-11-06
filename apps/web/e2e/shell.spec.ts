import { expect, test, type Page } from '@playwright/test';

import { axeViolations } from './support/axe';
import { open } from './support/open';

const SIDEBAR_KEY = 'forgemind-sidebar';

const sidebar = (page: Page) =>
  page.locator('nav[aria-label="Main"].material-nav');
const sidebarWidth = (page: Page) =>
  sidebar(page).evaluate((element) => element.getBoundingClientRect().width);

const labels = [
  'Overview',
  'Repositories',
  'Engineering Tasks',
  'Security',
  'Pull Requests',
  'Execution History',
  'Usage',
  'Settings',
];

test.describe('navigation', () => {
  test('lists every destination and marks the current one', async ({
    page,
  }) => {
    await open(page, '/tasks');

    const nav = sidebar(page);
    for (const label of labels) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
    await expect(
      nav.getByRole('link', { name: 'Engineering Tasks' }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(
      nav.getByRole('link', { name: 'Overview' }),
    ).not.toHaveAttribute('aria-current', 'page');
  });

  test('moves between pages without reloading the shell', async ({ page }) => {
    await open(page, '/');
    await page.evaluate(() => {
      (window as unknown as { shellMarker: number }).shellMarker = 42;
    });

    await sidebar(page).getByRole('link', { name: 'Security' }).click();
    await expect(
      page.getByRole('heading', { name: 'Security', level: 1 }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/security$/);

    expect(
      await page.evaluate(
        () => (window as unknown as { shellMarker: number }).shellMarker,
      ),
    ).toBe(42);
    await expect(
      sidebar(page).getByRole('link', { name: 'Security' }),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('works from the keyboard', async ({ page }) => {
    await open(page, '/');

    const link = sidebar(page).getByRole('link', { name: 'Usage' });
    await link.focus();
    await page.keyboard.press('Enter');

    await expect(
      page.getByRole('heading', { name: 'Usage', level: 1 }),
    ).toBeVisible();
  });
});

test.describe('compact mode', () => {
  test('collapses to icons with accessible names, and persists', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, '/');

    const before = await sidebarWidth(page);
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();

    await expect.poll(() => sidebarWidth(page)).toBeLessThan(before);
    await expect(
      sidebar(page).getByRole('link', { name: 'Repositories' }),
    ).toBeVisible();
    await expect(
      sidebar(page).getByText('Repositories', { exact: true }),
    ).toHaveClass(/sr-only/);

    await page.reload();
    await page.waitForSelector('html[data-hydrated]');
    expect(await sidebarWidth(page)).toBeLessThan(before);

    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await expect.poll(() => sidebarWidth(page)).toBe(before);
  });

  test('is applied before the page first paints', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript((key) => {
      localStorage.setItem(key, 'compact');
      (window as unknown as { widthsSeen: number[] }).widthsSeen = [];

      new MutationObserver(() => {
        const nav = document.querySelector<HTMLElement>(
          'nav[aria-label="Main"]',
        );
        if (nav) {
          (window as unknown as { widthsSeen: number[] }).widthsSeen.push(
            nav.getBoundingClientRect().width,
          );
        }
      }).observe(document, { childList: true, subtree: true });
    }, SIDEBAR_KEY);

    await open(page, '/');

    const widths = await page.evaluate(
      () => (window as unknown as { widthsSeen: number[] }).widthsSeen,
    );
    expect(widths.length).toBeGreaterThan(0);
    expect(new Set(widths.filter((width) => width > 0)).size).toBe(1);
    expect(await sidebarWidth(page)).toBe(64);
  });
});

test.describe('responsive layout', () => {
  test('desktop shows the full sidebar', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await open(page, '/');

    await expect(sidebar(page)).toBeVisible();
    expect(await sidebarWidth(page)).toBe(240);
    await expect(page.getByTestId('open-navigation')).toBeHidden();
  });

  test('laptop forces the compact sidebar', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await open(page, '/');

    expect(await sidebarWidth(page)).toBe(64);
    await expect(page.getByRole('button', { name: /sidebar/ })).toBeHidden();
  });

  test('tablet hides the sidebar behind a menu button', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await open(page, '/');

    await expect(sidebar(page)).toBeHidden();
    await page.getByTestId('open-navigation').click();

    const sheet = page.getByRole('dialog');
    await expect(
      sheet.getByRole('link', { name: 'Execution History' }),
    ).toBeVisible();
    await sheet.getByRole('link', { name: 'Execution History' }).click();

    await expect(sheet).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Execution History', level: 1 }),
    ).toBeVisible();
  });

  test('phone shows the bottom bar and nothing overflows', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '/');

    const bar = page.getByRole('navigation', { name: 'Main, compact' });
    await expect(bar).toBeVisible();
    await bar.getByRole('link', { name: 'Tasks' }).click();
    await expect(
      page.getByRole('heading', { name: 'Engineering Tasks', level: 1 }),
    ).toBeVisible();

    await bar.getByRole('button', { name: 'More' }).click();
    await expect(
      page.getByRole('dialog').getByRole('link', { name: 'Usage' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
});

test.describe('top bar', () => {
  test('shows the organization and the demo data label', async ({ page }) => {
    await open(page, '/');

    await expect(page.getByTestId('org-trigger')).toHaveText(
      /Ayinde Creations/,
    );
    await expect(page.getByTestId('data-source')).toHaveText('Demo data');
  });

  test('shows the repository selector on repository pages only', async ({
    page,
  }) => {
    await open(page, '/');
    await expect(page.getByTestId('repository-selector')).toHaveCount(0);

    await open(page, '/repositories/repo-1');
    const selector = page.getByTestId('repository-selector');
    await expect(selector).toHaveText(/forgemind\/api/);

    await selector.click();
    await page.getByRole('option', { name: 'forgemind/web' }).click();
    await expect(page).toHaveURL(/\/repositories\/repo-2$/);
    await expect(
      page.getByText('forgemind/web', { exact: true }).first(),
    ).toBeVisible();
  });

  test('lists notifications and marks them read', async ({ page }) => {
    await open(page, '/');

    const trigger = page.getByTestId('notifications-trigger');
    await expect(trigger).toHaveAttribute('aria-label', /unread/);
    await trigger.click();

    const panel = page.getByTestId('notifications');
    await expect(panel.getByText('Unread:')).not.toHaveCount(0);
    await panel.getByRole('button', { name: 'Mark all read' }).click();

    await expect(panel.getByText('Unread:')).toHaveCount(0);
    await expect(trigger).toHaveAttribute('aria-label', 'Notifications');
  });

  test('changes the theme from the profile menu', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page, '/');

    await page.getByTestId('profile-trigger').click();
    await expect(page.getByRole('menu')).toContainText('Ayinde');
    await page.getByRole('menuitemradio', { name: /light/ }).click();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('says when the API cannot be reached, and recovers', async ({
    page,
  }) => {
    await page.route('**/auth/session', (route) => route.abort());
    await open(page, '/');

    const banner = page
      .getByRole('alert')
      .filter({ hasText: "Can't reach the API" });
    await expect(banner).toBeVisible();

    await page.unroute('**/auth/session');
    await banner.getByRole('button', { name: 'Retry' }).click();
    await expect(banner).toHaveCount(0);
  });
});

test.describe('accessibility', () => {
  for (const theme of ['dark', 'light'] as const) {
    test(`the shell has no axe violations in the ${theme} theme`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });
      await open(page, '/tasks');

      expect(await axeViolations(page)).toEqual([]);
    });
  }

  test('the phone layout has no axe violations with the sheet open', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '/');
    await page.getByRole('button', { name: 'More' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    expect(await axeViolations(page)).toEqual([]);
  });
});
