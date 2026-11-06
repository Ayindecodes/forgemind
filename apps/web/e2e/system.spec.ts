import { expect, test } from '@playwright/test';

import { axeViolations } from './support/axe';
import { open } from './support/open';

test.describe('notifications and system pages', () => {
  test('the notification centre lists unread first and opens where each leads', async ({
    page,
  }) => {
    await open(page, '/notifications');
    const centre = page.getByTestId('notification-center');
    const api = 'http://localhost:4110';
    const served = (await (
      await page.request.get(`${api}/notifications`)
    ).json()) as {
      id: string;
      readAt: string | null;
      href: string | null;
    }[];
    const unread = served.filter(({ readAt }) => readAt === null);
    await expect(centre).toHaveAttribute('data-unread', String(unread.length));
    if (unread.length > 0) {
      await expect(centre.locator('li').first()).toHaveAttribute(
        'data-read',
        'false',
      );
      await expect(page.getByTestId('mark-all-read')).toBeEnabled();
    } else {
      await expect(page.getByTestId('mark-all-read')).toBeDisabled();
    }

    // Opening one marks it read and goes where it points. Other specs share
    // these notifications, so this takes one at most and clears nothing else.
    const target =
      unread.find(({ href }) => href) ?? served.find(({ href }) => href);
    expect(target).toBeTruthy();
    await page
      .getByTestId(`notification-${target!.id}`)
      .getByRole('button')
      .click();
    await expect(page).toHaveURL(new RegExp(`${target!.href}$`));
    const after = (await (
      await page.request.get(`${api}/notifications`)
    ).json()) as {
      id: string;
      readAt: string | null;
    }[];
    expect(after.find(({ id }) => id === target!.id)?.readAt).not.toBeNull();
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
