import { expect, test } from '@playwright/test';

import { open } from './support/open';

test('the app loads and reaches the API', async ({ page }) => {
  await open(page, '/');

  await expect(
    page.getByRole('heading', { name: 'ForgeMind', level: 1 }),
  ).toBeVisible();
  await expect(page.getByText('API: reachable')).toBeVisible();
});
