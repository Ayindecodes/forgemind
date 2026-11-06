import { expect, test, type Page } from '@playwright/test';

import { axeViolations } from './support/axe';
import { open } from './support/open';

const api = 'http://localhost:4110';
const fetchJson = async <T>(page: Page, path: string) =>
  (await (await page.request.get(`${api}${path}`)).json()) as T;

type Served = {
  id: string;
  taskId: string;
  state: string;
  url: string;
  reviewStatus: string;
  checksStatus: string;
};

test.describe('pull requests', () => {
  test('lists them as GitHub reports them, and offers no way to merge', async ({
    page,
  }) => {
    await open(page, '/pull-requests');
    const served = await fetchJson<{ items: Served[] }>(
      page,
      '/pull-requests?limit=200',
    );
    await expect(page.getByTestId('pr-count')).toHaveText(
      `${served.items.length} of ${served.items.length}`,
    );
    await expect(
      page.getByTestId('pr-summary').locator('[data-summary="open"]'),
    ).toHaveText(
      String(served.items.filter(({ state }) => state === 'open').length),
    );
    await expect(
      page.getByTestId('pr-summary').locator('[data-summary="merged"]'),
    ).toHaveText(
      String(served.items.filter(({ state }) => state === 'merged').length),
    );
    await expect(page.getByText('Nothing here merges.')).toBeVisible();
    expect(await page.getByRole('button', { name: /merge/i }).count()).toBe(0);
    expect(await page.getByRole('link', { name: /merge/i }).count()).toBe(0);

    const first = served.items[0]!;
    await expect(page.getByTestId(`pr-${first.id}`)).toHaveAttribute(
      'href',
      first.url,
    );
    await page.getByTestId(`pr-task-${first.taskId}`).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${first.taskId}$`));
  });

  test('narrows by state and by words', async ({ page }) => {
    await open(page, '/pull-requests');
    const served = await fetchJson<{ items: Served[] }>(
      page,
      '/pull-requests?limit=200',
    );
    await page.getByTestId('pr-state-filter').click();
    await page.getByRole('option', { name: 'Merged' }).click();
    await expect(page.getByTestId('pr-count')).toHaveText(
      new RegExp(
        `^${served.items.filter(({ state }) => state === 'merged').length} of `,
      ),
    );
    await page.getByTestId('pr-state-filter').click();
    await page.getByRole('option', { name: 'All' }).click();
    await page.getByTestId('pr-search').fill('124');
    await expect(page.getByTestId('pr-count')).toHaveText(/^1 of /);
    const table = page.getByTestId('table-scroll');
    await expect(table.getByText('Changes requested')).toBeVisible();
    await expect(table.getByText('Checks failed')).toBeVisible();
  });

  test('has no axe violations', async ({ page }) => {
    await open(page, '/pull-requests');
    await expect(page.getByTestId('pr-summary')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
});
