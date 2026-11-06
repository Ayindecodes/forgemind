import { expect, test, type Page } from '@playwright/test';

import { axeViolations } from './support/axe';
import { open } from './support/open';

/*
 * What a screen reader relies on along the core path: landmarks and a
 * single heading, names on controls, a sensible focus order, and live
 * regions that speak as the run moves. No screen reader runs here; these
 * are the things one would read.
 */

const routes = [
  '/',
  '/repositories',
  '/repositories/repo-1',
  '/tasks',
  '/tasks/new',
  '/tasks/task-2',
  '/tasks/task-2/review',
  '/tasks/task-2/report',
  '/security',
  '/pull-requests',
  '/history',
  '/usage',
  '/settings',
  '/notifications',
];

const landmarks = (page: Page) =>
  page.evaluate(() => ({
    main: document.querySelectorAll('main').length,
    h1: document.querySelectorAll('h1').length,
    nav: document.querySelector('nav[aria-label="Main"]') !== null,
    unnamedButtons: [...document.querySelectorAll('button')].filter(
      (button) => {
        if (button.closest('[aria-hidden="true"]')) return false;
        const id = button.getAttribute('id');
        const name =
          button.getAttribute('aria-label') ??
          button.getAttribute('aria-labelledby') ??
          button.getAttribute('title') ??
          (id && document.querySelector(`label[for="${id}"]`)?.textContent) ??
          button.textContent?.trim();
        return !name;
      },
    ).length,
    unlabelledInputs: [
      ...document.querySelectorAll('input, textarea, select'),
    ].filter((field) => {
      if (
        field.closest('[aria-hidden="true"]') ||
        field.getAttribute('type') === 'hidden'
      )
        return false;
      const id = field.getAttribute('id');
      return (
        !field.getAttribute('aria-label') &&
        !field.getAttribute('aria-labelledby') &&
        !field.closest('label') &&
        !(id && document.querySelector(`label[for="${id}"]`))
      );
    }).length,
  }));

test.describe('screen reader structure', () => {
  for (const route of routes) {
    test(`${route} has one main, one h1, named controls and no axe violations`, async ({
      page,
    }) => {
      await open(page, route);
      await page.waitForTimeout(800);
      const found = await landmarks(page);
      expect(found.main, 'main landmarks').toBe(1);
      expect(found.h1, 'h1 headings').toBe(1);
      expect(found.nav, 'main navigation').toBe(true);
      expect(found.unnamedButtons, 'buttons without a name').toBe(0);
      expect(found.unlabelledInputs, 'fields without a label').toBe(0);
      expect(await axeViolations(page), route).toEqual([]);
    });
  }
});

test.describe('the core path by keyboard, with live announcements', () => {
  test('from the overview to a running task, then a decision, without a pointer', async ({
    page,
  }) => {
    await open(page, '/');
    // Skip link first, then the sidebar, then the page.
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('link', { name: 'Skip to content' }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(page.getByTestId('new-task')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/tasks\/new$/);

    await page.getByTestId('composer-title').focus();
    await page.keyboard.type('Keyboard-only task');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('composer-request')).toBeFocused();
    await page.keyboard.type('Started without a pointer, to prove the path.');
    await page.getByTestId('composer-start').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/tasks\/task-\d+$/, { timeout: 15_000 });

    const announcer = page.getByTestId('run-announcer');
    await expect(announcer).toHaveAttribute('aria-live', 'polite');
    await expect(announcer).toContainText(/Run started|Inspection running/, {
      timeout: 20_000,
    });

    // A decision on a finished run: focus the control, confirm in the dialog, hear the result.
    await open(page, '/tasks/task-3');
    await expect(page.getByTestId('run-workspace')).toHaveAttribute(
      'data-connection',
      'live',
    );
    await page.getByTestId('reject').focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Reject' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('run-announcer')).toContainText(
      'Run completed',
      { timeout: 15_000 },
    );
  });
});
