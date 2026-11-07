import { expect, test, type Page } from '@playwright/test';

import { apiUrl } from '../playwright.shared';
import { open } from './support/open';

/*
 * The twelve steps of the MVP acceptance criteria, in order, as one person
 * in one session against the dev API. Nothing here touches a seeded task
 * another test relies on: the person signs in fresh, connects a repository
 * of their own, and works a task they created.
 */

const fetchJson = async <T>(page: Page, path: string) => {
  const response = await page.request.get(`${apiUrl}${path}`);
  expect(response.ok(), `${path} answered ${response.status()}`).toBe(true);
  return (await response.json()) as T;
};

type Task = { id: string; runId: string; status: string; decision: string };

test.use({ storageState: { cookies: [], origins: [] } });

test('a person goes from sign-in to a pull request and back to the history', async ({
  page,
}) => {
  test.setTimeout(300_000);
  let repositoryId = '';
  let taskId = '';

  await test.step('1. sign in securely', async () => {
    await page.goto('/tasks');
    await expect(page).toHaveURL(/\/sign-in/);
    await page.getByTestId('sign-in-github').click();
    await expect(page.getByRole('note')).toContainText('Simulated GitHub');
    await page.getByRole('link', { name: /Authorize as Ayinde/ }).click();
    await expect(page.getByTestId('org-trigger')).toContainText(
      'Ayinde Creations',
    );
    await expect(page).toHaveURL(/\/tasks$/);
  });

  await test.step('2. connect a repository with the right permissions', async () => {
    await open(page, '/repositories');
    const installation = page.getByTestId('installation');
    await expect(installation).toBeVisible();
    await expect(installation).toContainText(/: (read|write)/);
    await page.getByTestId('connect-repository').click();
    await page.getByTestId('connect-811008').click();
    await page.getByTestId('connect-selected').click();
    await expect(
      page.getByRole('link', { name: 'forgemind/cli' }),
    ).toBeVisible();
    const repositories = await fetchJson<{
      items: { id: string; fullName: string; status: string }[];
    }>(page, '/repositories?limit=100');
    const infra = repositories.items.find(
      (repository) => repository.fullName === 'forgemind/cli',
    );
    expect(infra).toBeTruthy();
    expect(['analyzing', 'connected']).toContain(infra!.status);
    repositoryId = infra!.id;
  });

  await test.step('3. request an engineering task', async () => {
    await open(page, `/tasks/new?repository=${repositoryId}`);
    await expect(page.getByTestId('composer-repository')).toContainText(
      'forgemind/cli',
    );
    await page
      .getByTestId('composer-title')
      .fill('Harden the deploy script against interrupted rollouts');
    await page
      .getByTestId('composer-request')
      .fill(
        'An interrupted rollout leaves the old and new revisions both live. Make the script roll back cleanly and add a test for it.',
      );
    await page.getByTestId('composer-start').click();
    await expect(page).toHaveURL(/\/tasks\/task-\d+$/, { timeout: 15_000 });
    taskId = page.url().split('/').at(-1)!;
  });

  await test.step("4. inspect the task's execution plan", async () => {
    const plan = page.getByTestId('plan');
    await expect(plan).toContainText('Plan:', { timeout: 60_000 });
    await expect(plan).toContainText('Acceptance');
  });

  await test.step('5. watch the task progress in real time', async () => {
    const workspace = page.getByTestId('run-workspace');
    await expect(workspace).toHaveAttribute('data-connection', 'live');
    await expect(page.getByTestId('stage-inspection')).toHaveAttribute(
      'data-status',
      'passed',
      { timeout: 60_000 },
    );
    await expect(page.getByTestId('stage-implementation')).toHaveAttribute(
      'data-status',
      /running|passed/,
      { timeout: 90_000 },
    );
    await expect(page.getByTestId('run-announcer')).toContainText(
      /Implementation (running|passed)/,
    );
  });

  await test.step('6. see which files were changed', async () => {
    await expect(page.getByTestId('stage-implementation')).toHaveAttribute(
      'data-status',
      'passed',
      { timeout: 90_000 },
    );
    const details = page.getByTestId('details');
    await details.getByRole('tab', { name: /Files/ }).click();
    const files = details.getByRole('tabpanel');
    await expect(files).not.toContainText('No files have been read');
    await expect(files).toContainText(/\.[a-z]+\b/);
  });

  await test.step('7. inspect the actual code diff', async () => {
    // The run finishes its work and waits for a decision; the stream stays
    // open until then, so the decision controls are the sign it is done.
    await expect(page.getByTestId('approve')).toBeVisible({
      timeout: 120_000,
    });
    await open(page, `/tasks/${taskId}/review`);
    const diff = page.getByTestId('diff-file');
    await expect(diff).toBeVisible();
    await expect(diff.locator('.diff-code-insert').first()).toBeVisible();
    await expect(
      diff.locator('.diff-code span[style*="color"]').first(),
    ).toBeVisible();
    await expect(
      page.getByTestId('file-tree').locator('button').first(),
    ).toBeVisible();
  });

  await test.step('8. review test and build results', async () => {
    await open(page, `/tasks/${taskId}`);
    const details = page.getByTestId('details');
    // Counts do not wait; visibility does, and a slower machine needs it.
    await details.getByRole('tab', { name: /Commands/ }).click();
    await expect(page.getByTestId('command').first()).toBeVisible();
    await details.getByRole('tab', { name: /Checks/ }).click();
    await expect(page.getByTestId('check').first()).toBeVisible();
  });

  await test.step('9. understand which checks passed or failed', async () => {
    const checks = page.getByTestId('check');
    for (const check of await checks.all()) {
      await expect(check).toHaveAttribute(
        'data-status',
        /passed|failed|error|skipped/,
      );
    }
    const outcome = page.getByTestId('outcome');
    await expect(outcome).toHaveAttribute('data-verification', 'verified');
    await expect(outcome).toHaveAttribute('data-outcome', 'succeeded');
    await expect(outcome).toContainText(/required checks? ran and passed/);
  });

  await test.step('10. approve the proposed changes', async () => {
    await page.getByTestId('approve').click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Approve' })
      .click();
    await expect(page.getByTestId('outcome')).toContainText(/Approved by/);
    const task = await fetchJson<Task>(page, `/tasks/${taskId}`);
    expect(task.decision).toBe('approved');
  });

  await test.step('11. create a pull request, being authorized', async () => {
    await page.getByTestId('open-pull-request').click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('never merges');
    await confirm.getByRole('button', { name: 'Open pull request' }).click();
    await expect(page.getByTestId('view-pull-request')).toBeVisible();
    expect(await page.getByRole('button', { name: /merge/i }).count()).toBe(0);
    await open(page, '/pull-requests');
    await expect(page.getByTestId(`pr-task-${taskId}`)).toBeVisible();
    expect(await page.getByRole('button', { name: /merge/i }).count()).toBe(0);
  });

  await test.step('12. reopen the task later and inspect its history', async () => {
    const task = await fetchJson<Task>(page, `/tasks/${taskId}`);
    await open(page, '/history');
    await expect(page.getByTestId(`run-${task.runId}`)).toBeVisible();
    await open(page, `/tasks/${taskId}`);
    await expect(page.getByTestId('run-workspace')).toHaveAttribute(
      'data-connection',
      'ended',
    );
    await expect(page.getByTestId('outcome')).toContainText(/Approved by/);
    await open(page, `/tasks/${taskId}/report`);
    await expect(page.getByTestId('report')).toContainText(
      'An interrupted rollout leaves the old and new revisions both live',
    );
    await expect(page.getByTestId('report-checks')).toBeVisible();
  });

  await test.step('the four endings stay distinct', async () => {
    await open(page, '/tasks/task-4');
    await expect(page.getByTestId('outcome')).toHaveAttribute(
      'data-verification',
      'unverified',
    );
    await open(page, '/tasks/task-5');
    await expect(page.getByTestId('outcome')).toHaveAttribute(
      'data-outcome',
      'failed',
    );
  });
});
