import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { axeViolations } from './support/axe';
import { open } from './support/open';

const signedOut = async (context: BrowserContext) => context.clearCookies();

/** On the simulated GitHub page, authorize as the named person. */
async function authorizeAs(page: Page, name: string) {
  await expect(page.getByRole('note')).toContainText('Simulated GitHub');
  await page
    .getByRole('link', { name: new RegExp(`Authorize as ${name}`) })
    .click();
}

test.describe('signing in', () => {
  test('a signed-out visit is sent to sign in and comes back afterwards', async ({
    page,
    context,
  }) => {
    await signedOut(context);
    await page.goto('/tasks');

    await expect(page).toHaveURL(/\/sign-in\?next=%2Ftasks$/);
    await expect(
      page.getByRole('heading', { name: 'Sign in to ForgeMind' }),
    ).toBeVisible();
    await expect(page.getByText('GitHub is simulated here')).toBeVisible();

    await page.getByTestId('sign-in-github').click();
    await authorizeAs(page, 'Ayinde');

    await expect(page).toHaveURL(/\/tasks$/);
    await expect(
      page.getByRole('heading', { name: 'Engineering Tasks', level: 1 }),
    ).toBeVisible();
    await expect(page.getByTestId('org-trigger')).toHaveText(
      /Ayinde Creations/,
    );
  });

  test('an expired session goes to the expired page, then back to sign in', async ({
    page,
    context,
  }) => {
    await signedOut(context);
    await context.addCookies([
      {
        name: 'fm_session',
        value: 'dev-expired',
        domain: 'localhost',
        path: '/',
      },
    ]);
    await page.goto('/security');

    await expect(page).toHaveURL(/\/session-expired\?next=%2Fsecurity$/);
    await expect(
      page.getByRole('heading', { name: 'Your session has expired' }),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Sign in again' }).click();
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fsecurity$/);
  });

  test('signing out clears the session and protects the app again', async ({
    page,
    context,
  }) => {
    // Sign in through the flow first. The suite shares one API process, and
    // signing out the fixed dev-owner token would sign every later test out.
    await signedOut(context);
    await page.goto('/sign-in');
    await page.getByTestId('sign-in-github').click();
    await authorizeAs(page, 'Ayinde');
    await expect(
      page.getByRole('heading', { name: 'Overview', level: 1 }),
    ).toBeVisible();

    await page.getByTestId('profile-trigger').click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();

    await expect(page).toHaveURL(/\/sign-in$/);
    await page.goto('/usage');
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fusage$/);
  });

  test('a next target must be a path on this app', async ({
    page,
    context,
  }) => {
    await signedOut(context);
    await page.goto('/sign-in?next=https%3A%2F%2Fevil.example');
    await page.getByTestId('sign-in-github').click();
    await authorizeAs(page, 'Ayinde');

    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('onboarding', () => {
  test('a new user creates an organization, installs the app, and reaches a connected repository', async ({
    page,
    context,
  }) => {
    await signedOut(context);
    await page.goto('/sign-in');
    await page.getByTestId('sign-in-github').click();
    await authorizeAs(page, 'Sam Rivera');

    // Step 1: organization
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByTestId('onboarding-organization')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.getByTestId('organization-name').fill('Rivera Labs');
    await page.getByRole('button', { name: 'Create organization' }).click();

    // Step 2: the GitHub App, with its permissions spelled out
    const install = page.getByTestId('onboarding-install');
    await expect(install).toBeVisible();
    await expect(install).toContainText('Never the default branch');
    await expect(install).toContainText('Not requested: Administration');
    expect(await axeViolations(page)).toEqual([]);
    await page.getByTestId('install-github').click();
    await expect(page.getByRole('note')).toContainText('Simulated GitHub');
    await expect(
      page.getByRole('heading', { name: 'Install ForgeMind on samrivera' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Install' }).click();

    // Step 3: repositories
    const choose = page.getByTestId('onboarding-repositories');
    await expect(choose).toBeVisible();
    await expect(choose.getByRole('checkbox')).toHaveCount(5);
    expect(await axeViolations(page)).toEqual([]);
    await page.getByTestId('repo-920001').click();
    await page.getByTestId('repo-920003').click();
    await page.getByTestId('connect-repositories').click();

    // Step 4: done, and both repositories are really connected
    const done = page.getByTestId('onboarding-done');
    await expect(done).toBeVisible();
    await expect(done).toContainText('2 repositories are connected');
    await expect(done).toContainText('samrivera/notes-api');
    await expect(done).toContainText('samrivera/data-pipeline');
    expect(await axeViolations(page)).toEqual([]);
    // Indexing runs at real speed here: eight seconds in the dev API.
    await expect(done.getByText('Indexed and ready')).toHaveCount(2, {
      timeout: 30_000,
    });
    expect(await axeViolations(page)).toEqual([]);
    await page.getByTestId('open-repository').click();

    await expect(page).toHaveURL(/\/repositories\/repo-\d+$/);
    await expect(
      page.getByText('samrivera/notes-api', { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByTestId('org-trigger')).toHaveText(/Rivera Labs/);

    // Nothing of the other organization is visible.
    await open(page, '/tasks/task-1');
    await expect(
      page.getByRole('heading', { name: 'Task not found', level: 1 }),
    ).toBeVisible();
  });

  test('a member with an organization skips straight past onboarding', async ({
    page,
  }) => {
    await page.goto('/onboarding');
    await expect(page.getByTestId('onboarding-done')).toBeVisible();
  });
});

test.describe('access denied', () => {
  test('explains the role and offers a way back', async ({ page }) => {
    await open(page, '/access-denied');

    await expect(
      page.getByRole('heading', { name: /don't have access/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Back to overview' }),
    ).toBeVisible();
  });
});

test.describe('accessibility', () => {
  for (const path of ['/sign-in', '/session-expired', '/access-denied']) {
    test(`${path} has no axe violations`, async ({ page, context }) => {
      await signedOut(context);
      await page.goto(path);
      await page.waitForSelector('html[data-hydrated]');
      expect(await axeViolations(page)).toEqual([]);
    });
  }
});
