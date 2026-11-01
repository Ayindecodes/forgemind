import { expect, test } from '@playwright/test';

test('the app loads and reaches the API', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'ForgeMind', level: 1 }),
  ).toBeVisible();
  await expect(page.getByText('API: reachable')).toBeVisible();
});
