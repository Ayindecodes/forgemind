import { expect, test } from '@playwright/test';

import { axeViolations } from './support/axe';
import { open } from './support/open';

const api = 'http://localhost:4110';

const sections = [
  'task',
  'repository',
  'investigation',
  'root-cause',
  'files',
  'changes',
  'commands',
  'checks',
  'findings',
  'unresolved',
  'outcome',
];

test.describe('the engineering report', () => {
  test('lists every field the spec names, in order, from the API', async ({
    page,
  }) => {
    await open(page, '/tasks/task-2/report');
    const report = page.getByTestId('report');
    await expect(report).toHaveAttribute('data-run', 'run-2');
    expect(
      await report
        .locator('[data-section]')
        .evaluateAll((nodes) =>
          nodes.map((node) => (node as HTMLElement).dataset.section),
        ),
    ).toEqual(sections);

    const served = (await (
      await page.request.get(`${api}/runs/run-2/report`)
    ).json()) as { commands: string[]; filesModified: string[]; task: string };
    await expect(report.locator('[data-section="task"]')).toContainText(
      served.task,
    );
    for (const path of served.filesModified)
      await expect(report.locator('[data-section="files"]')).toContainText(
        path,
      );
    expect(await report.locator('[data-section="commands"] li').count()).toBe(
      served.commands.length,
    );
    await expect(report.locator('[data-section="checks"]')).toContainText(
      '5 passed, 0 failed, 0 did not run',
    );
    await expect(
      report.locator('[data-section="findings"]').getByTestId('report-missing'),
    ).toContainText('No evidence was recorded by review-agent');
    await expect(
      report
        .locator('[data-section="unresolved"]')
        .getByTestId('report-missing'),
    ).toHaveText('None recorded.');
  });

  test('says what is missing on a failed run', async ({ page }) => {
    await open(page, '/tasks/task-5/report');
    const report = page.getByTestId('report');
    await expect(report.locator('[data-section="outcome"]')).toContainText(
      'Failed',
    );
    await expect(report.locator('[data-section="files"]')).toContainText(
      'No files were modified',
    );
    await expect(report.locator('[data-section="unresolved"] li')).toHaveCount(
      1,
    );
  });

  test('links to the diff, the checks, the events and the logs it summarises', async ({
    page,
  }) => {
    await open(page, '/tasks/task-2/report');
    await page.getByTestId('report-checks').click();
    await expect(page).toHaveURL(/\/tasks\/task-2#checks$/);
    await expect(page.getByRole('tab', { name: /^Checks/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.getByTestId('open-report').click();
    await expect(page).toHaveURL(/\/tasks\/task-2\/report$/);
    await page.getByTestId('report-review').click();
    await expect(page).toHaveURL(/\/tasks\/task-2\/review$/);
    await page.getByTestId('open-report').click();
    await expect(page.getByTestId('report')).toBeVisible();
  });

  test('is not written before the run finishes', async ({ page }) => {
    const created = await page.request.post(`${api}/tasks`, {
      data: {
        repositoryId: 'repo-1',
        title: 'Report before the end',
        request: 'Nothing to report yet.',
        category: 'fix_bug',
      },
    });
    const task = (await created.json()) as { id: string };
    await open(page, `/tasks/${task.id}/report`);
    await expect(page.getByText('No report yet')).toBeVisible();
    await page.getByRole('link', { name: 'Follow the run' }).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`));
  });

  test('prints without the shell, on light paper', async ({ page }) => {
    await open(page, '/tasks/task-2/report');
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
    await expect(page.getByTestId('print-report')).toBeHidden();
    await expect(page.getByTestId('report')).toBeVisible();

    // Dark on screen, light on paper, dark again afterwards.
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
      window.dispatchEvent(new Event('beforeprint'));
    });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('has no axe violations', async ({ page }) => {
    await open(page, '/tasks/task-2/report');
    await expect(page.getByTestId('report')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
});
