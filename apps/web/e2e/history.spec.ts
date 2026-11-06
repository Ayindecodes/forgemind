import { expect, test, type Page } from '@playwright/test';

import { axeViolations } from './support/axe';
import { open } from './support/open';

const api = 'http://localhost:4110';
const fetchJson = async <T>(page: Page, path: string) =>
  (await (await page.request.get(`${api}${path}`)).json()) as T;

type Served = {
  id: string;
  taskId: string;
  outcome: string | null;
  status: string;
  stages: { id: string; status: string }[];
};

test.describe('execution history', () => {
  test('lists every run and narrows by outcome', async ({ page }) => {
    await open(page, '/history');
    const served = await fetchJson<{ items: Served[] }>(
      page,
      '/runs?limit=200',
    );
    await expect(page.getByTestId('run-count')).toHaveText(
      `${served.items.length} runs`,
    );

    await page.getByTestId('run-outcome-filter').click();
    await page.getByRole('option', { name: 'failed' }).click();
    const failed = served.items.filter(
      ({ outcome }) => outcome === 'failed',
    ).length;
    await expect(page.getByTestId('run-count')).toHaveText(
      new RegExp(`^${failed} run`),
    );
  });

  test('any old run reopens with its full record', async ({ page }) => {
    await open(page, '/history');
    const served = await fetchJson<{ items: Served[] }>(
      page,
      '/runs?taskId=task-7&limit=10',
    );
    const task = await fetchJson<{ runId: string }>(page, '/tasks/task-7');
    const older = served.items.find(({ id }) => id !== task.runId);
    expect(older).toBeTruthy();

    const link = page.getByTestId(`run-${older!.id}`);
    await expect(link).toHaveAttribute('data-latest', 'false');
    await link.click();
    await expect(page).toHaveURL(
      new RegExp(`/tasks/task-7\\?run=${older!.id}$`),
    );

    const workspace = page.getByTestId('run-workspace');
    await expect(workspace).toHaveAttribute('data-connection', 'ended');
    await expect(page.getByTestId('older-run')).toContainText('earlier run');
    for (const stage of older!.stages)
      await expect(page.getByTestId(`stage-${stage.id}`)).toHaveAttribute(
        'data-status',
        stage.status,
      );
    await expect(page.getByTestId('outcome')).toHaveAttribute(
      'data-outcome',
      older!.outcome ?? '',
    );
    await expect(page.getByTestId('approve')).toHaveCount(0);

    await page.getByRole('link', { name: 'Latest run' }).click();
    await expect(page).toHaveURL(/\/tasks\/task-7$/);
    await expect(page.getByTestId('older-run')).toHaveCount(0);
  });

  test('has no axe violations', async ({ page }) => {
    await open(page, '/history');
    await expect(page.getByTestId('run-count')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
});
