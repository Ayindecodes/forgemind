import { expect, test } from '@playwright/test';

import { open } from './support/open';

test('the app loads inside its shell and reaches the API', async ({ page }) => {
  await open(page, '/');

  await expect(
    page.getByRole('heading', { name: 'Overview', level: 1 }),
  ).toBeVisible();
  await expect(page.getByTestId('data-source')).toHaveText('Demo data');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
});
