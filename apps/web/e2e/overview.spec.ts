import { expect, test, type Page } from '@playwright/test';

import { axeViolations } from './support/axe';
import { open } from './support/open';

const api = 'http://localhost:4110';
const fetchJson = async <T>(page: Page, path: string) =>
  (await (await page.request.get(`${api}${path}`)).json()) as T;

test.describe('the overview', () => {
  test('leads with the work that needs someone', async ({ page }) => {
    await open(page, '/');
    const sections = page.locator('main section[data-testid]');
    await expect(sections.first()).toHaveAttribute(
      'data-testid',
      'active-work',
    );

    const first = page.getByTestId('active-list').locator('li a').first();
    await expect(first).toHaveAttribute('data-status', 'awaiting_approval');
    const statuses = await page
      .getByTestId('active-list')
      .locator('li a')
      .evaluateAll((links) =>
        links.map((link) => (link as HTMLElement).dataset.status),
      );
    const rank = { awaiting_approval: 0, running: 1, queued: 2 } as const;
    for (let index = 1; index < statuses.length; index += 1) {
      expect(rank[statuses[index] as keyof typeof rank]).toBeGreaterThanOrEqual(
        rank[statuses[index - 1] as keyof typeof rank],
      );
    }
    await first.click();
    await expect(page).toHaveURL(/\/tasks\/task-\d+$/);
  });

  test('every number traces to the contract', async ({ page }) => {
    // Compare against the very responses the page received, so a run that
    // finishes on another worker in between cannot skew the comparison.
    const served = <T>(path: string) =>
      page
        .waitForResponse(
          (response) =>
            new URL(response.url()).pathname === path && response.ok(),
        )
        .then((response) => response.json() as Promise<T>);
    const usageServed = served<{
      runs: {
        total: number;
        succeeded: number;
        failed: number;
        partial: number;
        unverified: number;
      };
      quotas: { monthlyRuns: { used: number; max: number | null } };
    }>('/usage');
    const repositoriesServed = served<{ items: { status: string }[] }>(
      '/repositories',
    );
    const auditServed = served<{
      items: { actorName: string; target: { label: string } }[];
    }>('/audit');
    await open(page, '/');
    const usage = await usageServed;
    const panel = page.getByTestId('usage');
    await expect(panel.locator('[data-metric="runs"]')).toContainText(
      String(usage.runs.total),
    );
    await expect(panel.locator('[data-metric="runs"]')).toContainText(
      `${usage.runs.succeeded} succeeded`,
    );
    await expect(panel.locator('[data-metric="attention"]')).toContainText(
      String(usage.runs.failed + usage.runs.partial + usage.runs.unverified),
    );
    await expect(panel.locator('[data-metric="monthly-runs"]')).toContainText(
      String(usage.quotas.monthlyRuns.used),
    );

    const repositories = await repositoriesServed;
    const connected = repositories.items.filter(
      ({ status }) => status !== 'revoked',
    ).length;
    expect(
      await page.getByTestId('repository-list').locator('li').count(),
    ).toBe(Math.min(connected, 6));

    const audit = await auditServed;
    const latest = audit.items[0];
    await expect(
      page.getByTestId('activity-list').locator('li').first(),
    ).toContainText(latest?.actorName ?? '');
    await expect(
      page.getByTestId('activity-list').locator('li').first(),
    ).toContainText(latest?.target.label ?? '');
  });

  test('offers a new task from the top', async ({ page }) => {
    await open(page, '/');
    await page.getByTestId('new-task').click();
    await expect(page).toHaveURL(/\/tasks\/new$/);
  });

  test('fits a phone without overflowing', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '/');
    await expect(page.getByTestId('usage')).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`has no axe violations in the ${theme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await open(page, '/');
      await expect(page.getByTestId('activity-list')).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
    });
  }
});
