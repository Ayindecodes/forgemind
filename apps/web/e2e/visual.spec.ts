import { expect, test, type Page } from '@playwright/test';

import { apiUrl, ownerCookie, webUrl } from '../playwright.shared';
import { open } from './support/open';

/*
 * Screenshot comparison of the finished product in both themes. Runs through
 * playwright.visual.config.ts, whose dev API plays every seeded run to its
 * end at once, so the data on screen is the same every time. Anything that
 * still depends on the clock (relative times, the report's generation time,
 * the unread badge) is masked.
 */

const themes = ['dark', 'light'] as const;

type Route = {
  path: string;
  name: string;
  ready: string;
  /** On a phone the review shows its file list first; the diff is a tab. */
  readyPhone?: string;
  /** The components page shows skeletons on purpose. */
  skeletons?: 'shown';
};

const routes: Route[] = [
  { path: '/', name: 'overview', ready: '[data-testid="active-work"]' },
  {
    path: '/repositories',
    name: 'repositories',
    ready: '[data-testid="repository-count"]',
  },
  {
    path: '/repositories/repo-1',
    name: 'repository',
    ready: '[data-testid="analysis"]',
  },
  { path: '/tasks', name: 'tasks', ready: '[data-testid="task-count"]' },
  {
    path: '/tasks/new',
    name: 'composer',
    ready: '[data-testid="composer-start"]',
  },
  {
    path: '/tasks/task-2',
    name: 'workspace',
    // task-2 awaits a decision, so its stream stays open: live, and quiet.
    ready: '[data-testid="run-workspace"][data-connection="live"]',
  },
  {
    path: '/tasks/task-2/review',
    name: 'review',
    ready: '[data-testid="diff-file"] .diff-code span[style*="color"]',
    readyPhone: '[data-testid="review-workspace"]',
  },
  {
    path: '/tasks/task-2/report',
    name: 'report',
    ready: '[data-testid="report"]',
  },
  {
    path: '/security',
    name: 'security',
    ready: '[data-testid="finding-count"]',
  },
  {
    path: '/pull-requests',
    name: 'pull-requests',
    ready: '[data-testid="pr-count"]',
  },
  { path: '/history', name: 'history', ready: '[data-testid="run-count"]' },
  { path: '/usage', name: 'usage', ready: '[data-testid="cost-metric"]' },
  {
    path: '/settings',
    name: 'settings',
    ready: '[data-testid="invite-member"]',
  },
  {
    path: '/notifications',
    name: 'notifications',
    ready: '[data-testid="notification-center"]',
  },
  {
    path: '/design/components',
    name: 'components',
    ready: 'main h1',
    skeletons: 'shown',
  },
];

const phoneRoutes = routes.filter((route) =>
  ['overview', 'tasks', 'workspace', 'review'].includes(route.name),
);

const stateFor = (theme: (typeof themes)[number], signedIn = true) => ({
  cookies: signedIn ? [ownerCookie] : [],
  origins: [
    {
      origin: webUrl,
      localStorage: [{ name: 'forgemind-theme', value: theme }],
    },
  ],
});

/*
 * Relative times depend on when the server started, so every page runs with
 * its clock fixed five minutes after that moment, read from the run the
 * server finished at startup. Absolute times (the report's generation time,
 * the audit log) still differ between servers and are masked.
 */
let anchor = 0;

test.beforeAll(async ({ request }) => {
  const response = await request.get(`${apiUrl}/tasks/task-1`);
  const task = (await response.json()) as { updatedAt: string };
  anchor = new Date(task.updatedAt).getTime() + 5 * 60_000;
});

const masks = (page: Page) => [page.locator('time')];

async function settle(page: Page, route: Route, phone = false) {
  await page.clock.setFixedTime(anchor);
  await open(page, route.path);
  const ready = (phone && route.readyPhone) || route.ready;
  await page.locator(ready).first().waitFor({ timeout: 60_000 });
  await page.waitForLoadState('networkidle');
  if (route.skeletons !== 'shown') {
    await expect(page.locator('[data-skeleton]')).toHaveCount(0);
  }
}

for (const theme of themes) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme, storageState: stateFor(theme) });

    for (const route of routes) {
      test(`${route.name} looks as recorded`, async ({ page }) => {
        await settle(page, route);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page).toHaveScreenshot(`${route.name}-${theme}.png`, {
          mask: masks(page),
        });
      });
    }

    test.describe('on a phone', () => {
      test.use({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 1,
      });
      for (const route of phoneRoutes) {
        test(`${route.name} looks as recorded`, async ({ page }) => {
          await settle(page, route, true);
          await expect(page).toHaveScreenshot(
            `${route.name}-${theme}-phone.png`,
            { mask: masks(page) },
          );
        });
      }
    });

    test.describe('signed out', () => {
      test.use({ storageState: stateFor(theme, false) });
      test('sign-in looks as recorded', async ({ page }) => {
        await page.clock.setFixedTime(anchor);
        await open(page, '/sign-in');
        await page.getByTestId('sign-in-github').waitFor();
        await page.waitForLoadState('networkidle');
        await expect(page).toHaveScreenshot(`sign-in-${theme}.png`, {
          mask: masks(page),
        });
      });
    });
  });
}
