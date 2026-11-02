import type { Page } from '@playwright/test';

/**
 * Navigates and waits until React has hydrated. Keys pressed before that are
 * replayed by React, but libraries listening on the document never see them.
 */
export async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForSelector('html[data-hydrated]', { state: 'attached' });
}
