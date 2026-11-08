import { expect, test, type Page } from '@playwright/test';

import { axeViolations } from './support/axe';
import { open } from './support/open';

const api = 'http://localhost:4110';
const fetchJson = async <T>(page: Page, path: string) =>
  (await (await page.request.get(`${api}${path}`)).json()) as T;

type Repo = { id: string; fullName: string; status: string };

test.describe('repositories', () => {
  test('lists the active connections, broken ones first and obvious', async ({
    page,
  }) => {
    await open(page, '/repositories');
    const served = await fetchJson<{ items: Repo[] }>(
      page,
      '/repositories?limit=200',
    );
    const active = served.items.filter(({ status }) => status !== 'revoked');
    await expect(page.getByTestId('repository-count')).toHaveText(
      `${active.length} of ${served.items.length}`,
    );

    const broken = page.getByTestId('broken-connections');
    await expect(broken).toContainText('1 connection is broken');
    await expect(broken).toContainText('acme/payments');
    await expect(broken).toContainText('installation was suspended');
    await expect(page.locator('tbody tr').first()).toContainText(
      'acme/payments',
    );
    await expect(page.getByTestId('installation')).toContainText(
      'Installed on forgemind',
    );
  });

  test('searches and filters', async ({ page }) => {
    await open(page, '/repositories');
    await page.getByTestId('repository-search').fill('workers');
    await expect(page.getByTestId('repository-count')).toHaveText(/^1 of /);
    // By name, not by seeded id: the real API numbers repositories differently.
    await expect(
      page.getByRole('link', { name: 'forgemind/workers' }),
    ).toBeVisible();
    await page.getByTestId('repository-search').fill('');

    await page.getByTestId('repository-filter').click();
    await page.getByRole('option', { name: 'Needs attention' }).click();
    await expect(page.getByTestId('repository-count')).toHaveText(/^1 of /);
    await expect(
      page.getByRole('link', { name: 'acme/payments' }),
    ).toBeVisible();

    await page.getByTestId('repository-filter').click();
    await page.getByRole('option', { name: 'Revoked' }).click();
    await expect(
      page.getByRole('link', { name: 'acme/legacy-portal' }),
    ).toBeVisible();
    await expect(page.locator('[data-testid^="reconnect-"]')).toBeVisible();
  });

  test('connects a repository the App can see, then disconnects and reconnects it', async ({
    page,
  }) => {
    await open(page, '/repositories');
    await page.getByTestId('connect-repository').click();
    await page.getByTestId('connect-811006').click();
    await page.getByTestId('connect-selected').click();

    const link = page.getByRole('link', { name: 'forgemind/docs' });
    await expect(link).toBeVisible();
    const id = (await link.getAttribute('data-testid'))?.replace(
      'repository-',
      '',
    );
    expect(id).toBeTruthy();
    const served = await fetchJson<Repo>(page, `/repositories/${id}`);
    expect(served.status).toBe('analyzing');

    await page.getByTestId(`disconnect-${id}`).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Disconnect' })
      .click();
    await expect(
      page.getByRole('link', { name: 'forgemind/docs' }),
    ).toHaveCount(0);
    expect((await fetchJson<Repo>(page, `/repositories/${id}`)).status).toBe(
      'revoked',
    );

    await page.getByTestId('repository-filter').click();
    await page.getByRole('option', { name: 'Revoked' }).click();
    await page.getByTestId(`reconnect-${id}`).click();
    await expect
      .poll(
        async () =>
          (
            await fetchJson<{ items: Repo[] }>(page, '/repositories?limit=200')
          ).items.filter(({ fullName }) => fullName === 'forgemind/docs')
            .length,
      )
      .toBe(2);
  });

  test('fits a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '/repositories');
    await expect(page.getByTestId('broken-connections')).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });

  test('has no axe violations', async ({ page }) => {
    await open(page, '/repositories');
    await expect(page.getByTestId('installation')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
});
