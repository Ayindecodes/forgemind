import { expect, test, type Page } from '@playwright/test';

import { axeViolations } from './support/axe';
import { open } from './support/open';

const api = 'http://localhost:4110';

const fetchJson = async <T>(page: Page, path: string) =>
  (await (await page.request.get(`${api}${path}`)).json()) as T;

type Stage = { id: string; status: string; attempts: unknown[] };
type ApiEvent = { type: string; stage?: string };

test.describe('the execution workspace', () => {
  test('a replayed run shows only what its events say', async ({ page }) => {
    await open(page, '/tasks/task-2');
    const workspace = page.getByTestId('run-workspace');
    await expect(workspace).toHaveAttribute('data-connection', 'live');

    const task = await fetchJson<{ runId: string }>(page, '/tasks/task-2');
    const run = await fetchJson<{ stages: Stage[]; checks: unknown[] }>(
      page,
      `/runs/${task.runId}`,
    );
    const events = await fetchJson<ApiEvent[]>(
      page,
      `/runs/${task.runId}/events`,
    );
    await expect(workspace).toHaveAttribute(
      'data-event-count',
      String(events.length),
    );

    for (const stage of run.stages) {
      const item = page.getByTestId(`stage-${stage.id}`);
      await expect(item).toHaveAttribute('data-status', stage.status);
      await expect(item).toHaveAttribute(
        'data-attempts',
        String(stage.attempts.length),
      );
    }

    await page.getByRole('tab', { name: /^Commands/ }).click();
    expect(await page.getByTestId('command').count()).toBe(
      events.filter(({ type }) => type === 'command.started').length,
    );

    await page.getByRole('tab', { name: /^Checks/ }).click();
    expect(await page.getByTestId('check').count()).toBe(run.checks.length);

    await page.getByRole('tab', { name: /^Files/ }).click();
    const starts = events
      .map((event, index) => ({ event, index }))
      .filter(
        ({ event }) =>
          event.type === 'stage.started' && event.stage === 'implementation',
      );
    const from = starts.at(-1)?.index ?? 0;
    const changed = events
      .slice(from)
      .filter(({ type }) => type === 'file.changed').length;
    expect(
      await page
        .getByRole('list', { name: 'Changed files' })
        .getByRole('listitem')
        .count(),
    ).toBe(changed);
  });

  test('failed attempts stay visible after a retry', async ({ page }) => {
    // The seeded run is still playing its last half minute when the API has
    // just started; the outcome exists only once it has finished.
    await expect
      .poll(
        async () =>
          (await fetchJson<{ status: string }>(page, '/runs/run-1')).status,
        { timeout: 90_000 },
      )
      .not.toBe('running');
    await open(page, '/tasks/task-1');

    await expect(page.getByTestId('stage-testing')).toHaveAttribute(
      'data-attempts',
      '2',
    );
    const first = page.getByTestId('attempt-testing-1');
    await expect(first).toHaveAttribute('data-status', 'failed');
    await expect(first).toContainText('expected 1 to be 0');
    await expect(first).toContainText('1 failed, 43 passed');
    await expect(page.getByTestId('attempt-testing-2')).toHaveAttribute(
      'data-status',
      'passed',
    );
    await expect(page.getByTestId('stage-implementation')).toHaveAttribute(
      'data-attempts',
      '2',
    );

    const outcome = page.getByTestId('outcome');
    await expect(outcome).toHaveAttribute('data-verification', 'unverified');
    await expect(outcome).toContainText('Retries');
    await expect(outcome).toContainText('1 test failed');
  });

  test('security is a labelled step inside review', async ({ page }) => {
    await open(page, '/tasks/task-2');
    const security = page
      .getByTestId('stage-review')
      .getByTestId('security-step');

    await expect(security).toBeVisible();
    await expect(security).toContainText('Security');
    await expect(security).toContainText('Security scan passed');
  });

  test('the plan is shown as the agent wrote it', async ({ page }) => {
    await open(page, '/tasks/task-2');
    const plan = page.getByTestId('plan');

    await expect(plan).toContainText('Plan:');
    await expect(plan.getByText('Agent note')).toBeVisible();
  });

  test('approving records the decision, then a pull request can be opened', async ({
    page,
  }) => {
    await open(page, '/tasks/task-11');
    await page.getByTestId('approve').click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Approve' })
      .click();

    await expect(page.getByTestId('run-workspace')).toHaveAttribute(
      'data-connection',
      'ended',
    );
    await expect(page.getByTestId('open-pull-request')).toBeVisible();
    await page.getByTestId('open-pull-request').click();
    await expect(page.getByTestId('view-pull-request')).toBeVisible();

    const pulls = await fetchJson<{ items: { taskId: string }[] }>(
      page,
      '/pull-requests?limit=200',
    );
    expect(pulls.items.some((pr) => pr.taskId === 'task-11')).toBe(true);
  });

  test('requesting changes starts a new run with the instructions', async ({
    page,
  }) => {
    await open(page, '/tasks/task-3');
    const before = await fetchJson<{ runId: string }>(page, '/tasks/task-3');

    await page.getByTestId('request-changes').click();
    await page
      .getByTestId('revision-instructions')
      .fill('Cover the exhausted-budget case properly.');
    await page.getByTestId('send-revision').click();

    await expect
      .poll(
        async () =>
          (await fetchJson<{ runId: string }>(page, '/tasks/task-3')).runId,
      )
      .not.toBe(before.runId);
    const workspace = page.getByTestId('run-workspace');
    await expect(workspace).toHaveAttribute('data-connection', 'live', {
      timeout: 15_000,
    });
    await expect(page.getByTestId('stage-inspection')).toHaveAttribute(
      'data-status',
      /running|passed/,
      { timeout: 15_000 },
    );
    await expect(page.getByText('Attempt 1 of')).toBeVisible();
  });

  test('cancelling stops the run where it is', async ({ page }) => {
    const created = await page.request.post(`${api}/tasks`, {
      data: {
        repositoryId: 'repo-1',
        title: 'Cancel this one',
        request: 'Start and then stop.',
        category: 'fix_bug',
      },
    });
    const task = (await created.json()) as { id: string };
    await open(page, `/tasks/${task.id}`);
    const workspace = page.getByTestId('run-workspace');
    await expect(workspace).toHaveAttribute('data-connection', 'live');

    await page.getByTestId('cancel-run').click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Cancel run' })
      .click();

    await expect(workspace).toHaveAttribute('data-connection', 'ended', {
      timeout: 10_000,
    });
    await expect(page.getByTestId('outcome')).toContainText('Cancelled');
    expect(
      await page
        .locator('[data-testid^="stage-"][data-status="skipped"]')
        .count(),
    ).toBeGreaterThan(0);
  });

  test('the logs tab shows the output and can focus one command', async ({
    page,
  }) => {
    await open(page, '/tasks/task-2');
    await page.getByRole('tab', { name: /^Logs/ }).click();
    const count = page.getByTestId('log-count');
    await expect(count).toHaveText(/^\d+ lines$/);
    // The commands that ran are in the log, found by search rather than by
    // what happens to be rendered.
    await page.getByTestId('log-search').fill('$ pnpm');
    await expect(page.getByTestId('log-match-count')).toHaveText(/^1 of \d+$/);
    await page.getByTestId('log-search').fill('');

    await page.getByRole('tab', { name: /^Commands/ }).click();
    await page.getByTestId('command').first().locator('summary').click();
    await page.getByTestId('show-in-logs').first().click();
    await expect(page.getByRole('tab', { name: /^Logs/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(count).toHaveText(/^\d+ of \d+ lines$/);
    await page.getByRole('button', { name: /One command/ }).click();
    await expect(count).toHaveText(/^\d+ lines$/);
  });

  test('on a phone it stacks, outcome first, and nothing overflows', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '/tasks/task-2');
    await expect(page.getByTestId('outcome')).toBeVisible();

    const layout = await page.evaluate(() => {
      const root = document.documentElement;
      const outcome = document.querySelector('[data-testid="outcome"]');
      const stage = document.querySelector('[data-testid="stage-inspection"]');
      return {
        overflow: root.scrollWidth - root.clientWidth,
        outcomeFirst:
          outcome && stage
            ? outcome.getBoundingClientRect().top <
              stage.getBoundingClientRect().top
            : null,
      };
    });
    expect(layout.overflow).toBeLessThanOrEqual(0);
    expect(layout.outcomeFirst).toBe(true);
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`has no axe violations in the ${theme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await open(page, '/tasks/task-1');
      await expect(page.getByTestId('attempt-testing-1')).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
    });
  }
});
