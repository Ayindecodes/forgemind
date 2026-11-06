import { expect, test, type Page } from '@playwright/test';

import { axeViolations } from './support/axe';
import { open } from './support/open';

const api = 'http://localhost:4110';
const fetchJson = async <T>(page: Page, path: string) =>
  (await (await page.request.get(`${api}${path}`)).json()) as T;

test.describe('engineering tasks', () => {
  test('lists every task, newest first, and narrows by words, status and repository', async ({
    page,
  }) => {
    await open(page, '/tasks');
    const served = await fetchJson<{
      items: { status: string; repositoryId: string }[];
    }>(page, '/tasks?limit=200');
    await expect(page.getByTestId('task-count')).toHaveText(
      `${served.items.length} of ${served.items.length}`,
    );

    await page.getByTestId('task-status-filter').click();
    await page.getByRole('option', { name: 'Needs decision' }).click();
    const awaiting = served.items.filter(
      ({ status }) => status === 'awaiting_approval',
    ).length;
    await expect(page.getByTestId('task-count')).toHaveText(
      new RegExp(`^${awaiting} of `),
    );

    await page.getByTestId('task-status-filter').click();
    await page.getByRole('option', { name: 'All' }).click();
    await page.getByTestId('task-repository-filter').click();
    await page.getByRole('option', { name: 'forgemind/web' }).click();
    const onWeb = served.items.filter(
      ({ repositoryId }) => repositoryId === 'repo-2',
    ).length;
    await expect(page.getByTestId('task-count')).toHaveText(
      new RegExp(`^${onWeb} of `),
    );

    await page.getByTestId('task-search').fill('retry budget overflow');
    await expect(page.getByTestId('task-count')).toHaveText(/^0 of /);
    await page.getByTestId('task-repository-filter').click();
    await page.getByRole('option', { name: 'All repositories' }).click();
    await expect(page.getByTestId('task-count')).toHaveText(/^1 of /);
    await expect(page.getByTestId('task-task-2')).toBeVisible();
  });

  test('a new task flows straight into the live workspace', async ({
    page,
  }) => {
    await open(page, '/tasks/new?repository=repo-2');
    await expect(page.getByTestId('composer-repository')).toContainText(
      'forgemind/web',
    );

    await page.getByTestId('composer-start').click();
    await expect(page.getByText('Give the task a short title.')).toBeVisible();
    await expect(
      page.getByText('Say what should change, in your own words.'),
    ).toBeVisible();

    await page.getByTestId('composer-category').click();
    await page.getByRole('option', { name: 'Add tests' }).click();
    await expect(
      page.getByText('Cover existing behaviour with tests'),
    ).toBeVisible();
    await page.getByTestId('composer-title').fill('Cover the theme switcher');
    await page
      .getByTestId('composer-request')
      .fill('The theme switcher has no tests. Cover system, light and dark.');
    await page.getByTestId('composer-retries').fill('1');
    await page.getByTestId('composer-start').click();

    await expect(page).toHaveURL(/\/tasks\/task-\d+$/, { timeout: 15_000 });
    await expect(
      page.getByRole('heading', { name: 'Cover the theme switcher', level: 1 }),
    ).toBeVisible();
    await expect(page.getByTestId('run-workspace')).toHaveAttribute(
      'data-connection',
      'live',
    );
    const id = page.url().split('/').pop() ?? '';
    const task = await fetchJson<{
      category: string;
      repositoryId: string;
      budget: { maxRetries: number };
    }>(page, `/tasks/${id}`);
    expect(task).toMatchObject({
      category: 'add_tests',
      repositoryId: 'repo-2',
      budget: { maxRetries: 1 },
    });
  });

  test('has no axe violations on the list and the composer', async ({
    page,
  }) => {
    await open(page, '/tasks');
    await expect(page.getByTestId('task-task-2')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await open(page, '/tasks/new');
    await expect(page.getByTestId('task-composer')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
});
