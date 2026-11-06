import type { Page } from '@playwright/test';

/**
 * Navigates and waits until the page can take input: React has hydrated, and
 * on app routes the session check has let the shell through. Keys pressed
 * before hydration are replayed by React but never reach libraries listening
 * on the document, and the shell's shortcuts only exist once it is mounted.
 */
export async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForSelector('html[data-hydrated]', { state: 'attached' });
  await page
    .locator('[data-auth-gate="checking"]')
    .waitFor({ state: 'detached' });
}
