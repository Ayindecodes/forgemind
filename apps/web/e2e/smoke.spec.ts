import { expect, test } from '@playwright/test';

import { open } from './support/open';

test('the app loads and reaches the API', async ({ page }) => {
  await open(page, '/');

  await expect(
    page.getByRole('heading', { name: 'Overview', level: 1 }),
  ).toBeVisible();
  await expect(page.getByTestId('api-status')).toHaveText('API reachable');
});
