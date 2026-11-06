import { expect, test, type Page } from '@playwright/test';

import { axeViolations } from './support/axe';
import { open } from './support/open';

const api = 'http://localhost:4110';
const fetchJson = async <T>(page: Page, path: string) =>
  (await (await page.request.get(`${api}${path}`)).json()) as T;

type Usage = {
  tokens: { input: number; output: number }[];
  runs: { total: number; succeeded: number; failed: number };
  cost: { kind: string; amountUsd?: number; reason?: string };
  quotas: { monthlyRuns: { used: number; max: number | null } };
};

test.describe('usage', () => {
  test('shows every figure as the contract gives it, and labels the cost by kind', async ({
    page,
  }) => {
    await open(page, '/usage');
    const served = await fetchJson<Usage>(page, '/usage');

    const cost = page.getByTestId('cost-metric');
    await expect(cost).toHaveAttribute('data-kind', served.cost.kind);
    if (served.cost.kind === 'estimate') {
      await expect(cost).toContainText('Estimated cost');
      await expect(cost).toContainText('Estimate');
      await expect(page.getByTestId('cost-note')).toContainText('Estimated');
    } else if (served.cost.kind === 'actual') {
      await expect(cost).toContainText('Actual cost');
      await expect(cost).not.toContainText('Estimate');
    } else {
      await expect(cost).toContainText(served.cost.reason ?? '');
    }

    expect(await page.getByTestId('token-row').count()).toBe(
      served.tokens.length,
    );
    await expect(page.getByTestId('runs')).toContainText(
      `Runs (${served.runs.total})`,
    );
    await expect(
      page
        .getByTestId('runs-succeeded')
        .locator('xpath=following-sibling::dd[2]'),
    ).toContainText(String(served.runs.succeeded));
    await expect(page.getByTestId('quota-monthlyRuns')).toContainText(
      served.quotas.monthlyRuns.max === null
        ? 'no limit'
        : `of ${served.quotas.monthlyRuns.max}`,
    );
  });

  test('has no axe violations', async ({ page }) => {
    await open(page, '/usage');
    await expect(page.getByTestId('cost-metric')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
});
