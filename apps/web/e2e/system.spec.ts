import { expect, test } from '@playwright/test';

import { axeViolations } from './support/axe';
import { open } from './support/open';

test.describe('notifications and system pages', () => {
  test('the notification centre lists unread first, opens where each leads, and can clear them', async ({
    page,
  }) => {
    await open(page, '/notifications');
    const centre = page.getByTestId('notification-center');
    const served = (await (
      await page.request.get('http://localhost:4110/notifications')
    ).json()) as { id: string; readAt: string | null; href: string | null }[];
    const unread = served.filter(({ readAt }) => readAt === null);
    await expect(centre).toHaveAttribute('data-unread', String(unread.length));
    const first = centre.locator('li').first();
    if (unread.length > 0)
      await expect(first).toHaveAttribute('data-read', 'false');

    const withHref = served.find(({ href }) => href);
    if (withHref) {
      await page
        .getByTestId(`notification-${withHref.id}`)
        .getByRole('button')
        .click();
      await expect(page).toHaveURL(new RegExp(`${withHref.href}$`));
      await open(page, '/notifications');
    }
    await page.getByTestId('mark-all-read').click();
    await expect(centre).toHaveAttribute('data-unread', '0');
    await expect(page.getByTestId('mark-all-read')).toBeDisabled();
  });

  test('the menu leads to the centre', async ({ page }) => {
    await open(page, '/');
    await page.getByTestId('notifications-trigger').click();
    await page.getByTestId('see-all-notifications').click();
    await expect(page).toHaveURL(/\/notifications$/);
  });

  test('a missing page says so and leads back', async ({ page }) => {
    await open(page, '/no-such-page');
    await expect(
      page.getByRole('heading', { name: 'Page not found' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Back to overview' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('the maintenance and offline pages offer a way forward', async ({
    page,
  }) => {
    await open(page, '/maintenance');
    await expect(page.getByTestId('maintenance-page')).toContainText(
      'being updated',
    );
    await page.getByRole('link', { name: 'Try again' }).click();
    await expect(page).toHaveURL(/\/$/);

    await open(page, '/offline');
    await expect(page.getByTestId('offline-page')).toContainText(
      'You are offline',
    );
    await expect(page.getByTestId('offline-retry')).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Back to overview' }),
    ).toBeVisible();
  });

  test('going offline shows a notice across the app, and it leaves when the network is back', async ({
    page,
    context,
  }) => {
    await open(page, '/');
    await expect(page.getByTestId('offline-notice')).toHaveCount(0);
    await context.setOffline(true);
    await expect(page.getByTestId('offline-notice')).toContainText(
      'You are offline',
    );
    await context.setOffline(false);
    await expect(page.getByTestId('offline-notice')).toHaveCount(0);
  });

  test('has no axe violations', async ({ page }) => {
    for (const path of ['/notifications', '/maintenance', '/offline']) {
      await open(page, path);
      expect(await axeViolations(page), path).toEqual([]);
    }
  });
});
