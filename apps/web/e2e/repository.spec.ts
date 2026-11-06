import { expect, test, type Page } from '@playwright/test';

import { axeViolations } from './support/axe';
import { open } from './support/open';

const api = 'http://localhost:4110';
const fetchJson = async <T>(page: Page, path: string) =>
  (await (await page.request.get(`${api}${path}`)).json()) as T;

test.describe('the repository detail', () => {
  test('presents the analysis with evidence linked to the code at its commit', async ({
    page,
  }) => {
    await open(page, '/repositories/repo-1');
    const analysis = page.getByTestId('analysis');
    const served = await fetchJson<{
      commit: string;
      summary: string;
      entryPoints: { path: string }[];
      modules: unknown[];
      dependencies: { vulnerable: boolean }[];
      concerns: { evidence: { path: string; line: number | null }[] }[];
    }>(page, '/repositories/repo-1/analysis');
    const repo = await fetchJson<{ url: string }>(page, '/repositories/repo-1');

    await expect(analysis).toHaveAttribute('data-commit', served.commit);
    await expect(analysis).toContainText(served.summary);
    for (const title of [
      'Summary',
      'Entry points',
      'Architecture',
      'Languages',
      'Dependencies',
      'Tests and builds',
      'Documentation',
      'Concerns',
    ])
      await expect(analysis.locator(`[data-row="${title}"]`)).toBeVisible();
    expect(await analysis.getByTestId('concern').count()).toBe(
      served.concerns.length,
    );

    const evidence = served.concerns[0]?.evidence[0];
    expect(evidence).toBeTruthy();
    const link = analysis
      .getByTestId('concern')
      .first()
      .getByTestId('code-link')
      .first();
    await expect(link).toHaveAttribute(
      'href',
      `${repo.url}/blob/${served.commit}/${evidence!.path}${evidence!.line !== null ? `#L${evidence!.line}` : ''}`,
    );
    await expect(analysis.getByTestId('vulnerable-count')).toContainText(
      `${served.dependencies.filter((dep) => dep.vulnerable).length} with a known advisory`,
    );
  });

  test('lists the findings and the task history of the repository', async ({
    page,
  }) => {
    await open(page, '/repositories/repo-1');
    const findings = await fetchJson<{ items: unknown[] }>(
      page,
      '/findings?repositoryId=repo-1&limit=200',
    );
    const tasks = await fetchJson<{ items: { id: string }[] }>(
      page,
      '/tasks?repositoryId=repo-1&limit=50',
    );
    await expect(page.getByTestId('repository-findings')).toContainText(
      `Findings (${findings.items.length})`,
    );
    await expect(page.getByTestId('repository-tasks')).toContainText(
      `Task history (${tasks.items.length})`,
    );
    await page.getByTestId(`history-${tasks.items[0]?.id}`).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${tasks.items[0]?.id}$`));
  });

  test('says why there is no analysis for a broken connection', async ({
    page,
  }) => {
    await open(page, '/repositories/repo-4');
    await expect(page.getByTestId('analysis-missing')).toContainText(
      'No analysis available',
    );
    await expect(page.getByTestId('analysis-missing')).toContainText(
      'suspended',
    );
    await expect(page.getByTestId('analysis')).toHaveCount(0);
  });

  test('has no axe violations', async ({ page }) => {
    await open(page, '/repositories/repo-1');
    await expect(page.getByTestId('analysis')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
});

test('starts a task on this repository without leaving the path', async ({
  page,
}) => {
  const repository = await fetchJson<{ fullName: string }>(
    page,
    '/repositories/repo-1',
  );
  await open(page, '/repositories/repo-1');
  await page.getByTestId('new-task').click();
  await expect(page).toHaveURL(/\/tasks\/new\?repository=repo-1$/);
  await expect(page.getByTestId('composer-repository')).toContainText(
    repository.fullName,
  );
});
