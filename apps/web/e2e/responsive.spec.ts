import { expect, test, type Page } from '@playwright/test';

import { open } from './support/open';

/*
 * Every route at real sizes. Nothing may overflow sideways, and on a phone
 * every control a finger can reach must be large enough to hit.
 */

const routes = [
  '/',
  '/repositories',
  '/repositories/repo-1',
  '/tasks',
  '/tasks/new',
  '/tasks/task-1',
  '/tasks/task-2/review',
  '/tasks/task-2/report',
  '/security',
  '/pull-requests',
  '/history',
  '/usage',
  '/settings',
  '/notifications',
];

const sizes = [
  { name: 'phone', width: 390, height: 844, touch: true },
  { name: 'tablet', width: 820, height: 1180, touch: true },
  { name: 'laptop', width: 1280, height: 800, touch: false },
] as const;

/** The smallest side of a control a finger must hit. */
const MIN_TOUCH = 36;

const settle = async (page: Page) => {
  // Content arrives from the API; give the first queries a moment.
  await page.waitForTimeout(800);
};

const overflow = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );

const smallTargets = (page: Page) =>
  page.evaluate((min) => {
    const controls = document.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="switch"], [role="checkbox"]',
    );
    const small: string[] = [];
    for (const control of controls) {
      const rect = control.getBoundingClientRect();
      const style = getComputedStyle(control);
      if (
        rect.width === 0 ||
        rect.height === 0 ||
        style.visibility === 'hidden'
      )
        continue;
      if (rect.bottom < 0 || rect.top > window.innerHeight * 3) continue;
      // Visually hidden helpers (skip links, the native select behind a
      // custom one) are not touch targets; neither are links inside prose.
      if (control.closest('[aria-hidden="true"]')) continue;
      if (rect.width <= 1 && rect.height <= 1) continue;
      if (control.tagName === 'A' && style.display === 'inline') continue;
      if (rect.width < min || rect.height < min) {
        small.push(
          `${control.tagName.toLowerCase()}${control.getAttribute('data-testid') ? `[${control.getAttribute('data-testid')}]` : ''} "${(control.textContent ?? control.getAttribute('aria-label') ?? '').trim().slice(0, 30)}" ${Math.round(rect.width)}x${Math.round(rect.height)}`,
        );
      }
    }
    return small;
  }, MIN_TOUCH);

for (const size of sizes) {
  test.describe(`${size.name} (${size.width}x${size.height})`, () => {
    test.use({
      viewport: { width: size.width, height: size.height },
      hasTouch: size.touch,
      isMobile: size.touch,
    });

    for (const route of routes) {
      test(`${route} fits and is usable`, async ({ page }) => {
        await open(page, route);
        await settle(page);
        expect(
          await overflow(page),
          `horizontal overflow on ${route}`,
        ).toBeLessThanOrEqual(0);
        if (size.touch) {
          expect(await smallTargets(page), `touch targets on ${route}`).toEqual(
            [],
          );
        }
      });
    }
  });
}
