import { expect, test, type Page } from '@playwright/test';

import { axeViolations } from './support/axe';
import { open } from './support/open';

const api = 'http://localhost:4110';

type Usage = {
  tokens: { provider: string; model: string; input: number; output: number }[];
  runs: {
    total: number;
    succeeded: number;
    partial: number;
    failed: number;
    unverified: number;
  };
  cost: { kind: string; amountUsd?: number; reason?: string };
  quotas: { monthlyRuns: { used: number; max: number | null } };
};

/**
 * The summary the page itself is served, so that a run another test starts
 * in between cannot skew the comparison.
 */
const servedTo = (page: Page) =>
  page
    .waitForResponse(
      (response) => response.url() === `${api}/usage` && response.ok(),
    )
    .then((response) => response.json() as Promise<Usage>);

/** Answers the page's request for usage with the service's own, changed. */
const serving = (page: Page, change: (usage: Usage) => Usage) =>
  page.route(`${api}/usage`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: change((await response.json()) as Usage),
    });
  });

const written = (value: number) => value.toLocaleString('en-US');

test.describe('usage', () => {
  test('shows every figure as the contract gives it, and labels the cost by kind', async ({
    page,
  }) => {
    const answered = servedTo(page);
    await open(page, '/usage');
    const served = await answered;

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
      await expect(page.getByTestId('cost-note')).toHaveCount(0);
    }

    const rows = page.getByTestId('token-row');
    await expect(rows).toHaveCount(served.tokens.length);
    await expect(page.getByTestId('tokens-empty')).toHaveCount(
      served.tokens.length === 0 ? 1 : 0,
    );
    for (const [index, row] of served.tokens.entries()) {
      const cells = rows.nth(index).locator('td');
      await expect(cells.nth(0)).toContainText(row.model);
      await expect(cells.nth(0)).toContainText(row.provider);
      await expect(cells.nth(1)).toHaveText(written(row.input));
      await expect(cells.nth(2)).toHaveText(written(row.output));
      await expect(cells.nth(3)).toHaveText(written(row.input + row.output));
    }

    await expect(page.getByTestId('runs')).toContainText(
      `Runs (${served.runs.total})`,
    );
    for (const outcome of [
      'succeeded',
      'partial',
      'unverified',
      'failed',
    ] as const) {
      await expect(
        page
          .getByTestId(`runs-${outcome}`)
          .locator('xpath=following-sibling::dd[2]'),
      ).toContainText(String(served.runs[outcome]));
    }
    await expect(page.getByTestId('quota-monthlyRuns')).toContainText(
      served.quotas.monthlyRuns.max === null
        ? 'no limit'
        : `of ${served.quotas.monthlyRuns.max}`,
    );
  });

  test('gives the reason in place of a cost that is not available', async ({
    page,
  }) => {
    // The model is invented for this test.
    const reason = 'No price is set on this server for example/model-a.';
    await serving(page, (usage) => ({
      ...usage,
      cost: { kind: 'unavailable', reason },
    }));
    await open(page, '/usage');

    const cost = page.getByTestId('cost-metric');
    await expect(cost).toHaveAttribute('data-kind', 'unavailable');
    await expect(cost).toContainText(reason);
    await expect(cost).not.toContainText('$');
    await expect(cost).not.toContainText('Estimate');
    await expect(page.getByTestId('cost-note')).toHaveCount(0);
  });

  test('says that no model was called where none was', async ({ page }) => {
    await serving(page, (usage) => ({ ...usage, tokens: [] }));
    await open(page, '/usage');

    await expect(page.getByTestId('tokens-empty')).toContainText(
      'No model calls in this period',
    );
    await expect(page.getByTestId('token-row')).toHaveCount(0);
    await expect(page.getByTestId('tokens-metric')).toContainText('0');
  });

  test('has no axe violations', async ({ page }) => {
    await open(page, '/usage');
    await expect(page.getByTestId('cost-metric')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
});
