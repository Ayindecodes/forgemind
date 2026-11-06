import { expect, test, type Page } from '@playwright/test';

import { axeViolations } from './support/axe';
import { open } from './support/open';

const api = 'http://localhost:4110';
const fetchJson = async <T>(page: Page, path: string) =>
  (await (await page.request.get(`${api}${path}`)).json()) as T;

type Served = {
  id: string;
  confidence: string;
  status: string;
  severity: string;
  advisoryUrl: string | null;
  repositoryId: string;
};

test.describe('security', () => {
  test('keeps confirmed findings and suspicions apart, every one labelled', async ({
    page,
  }) => {
    await open(page, '/security');
    const served = await fetchJson<{ items: Served[] }>(
      page,
      '/findings?limit=200',
    );
    const open_ = served.items.filter(({ status }) => status === 'open');
    await expect(page.getByTestId('finding-count')).toHaveText(
      `${open_.length} of ${served.items.length}`,
    );

    const confirmed = page.getByTestId('findings-confirmed');
    const suspicions = page.getByTestId('findings-suspicions');
    await expect(confirmed).toHaveAttribute(
      'data-count',
      String(
        open_.filter(({ confidence }) => confidence === 'confirmed').length,
      ),
    );
    await expect(suspicions).toHaveAttribute(
      'data-count',
      String(
        open_.filter(({ confidence }) => confidence !== 'confirmed').length,
      ),
    );
    expect(
      await confirmed.locator('li:not([data-confidence="confirmed"])').count(),
    ).toBe(0);
    expect(
      await suspicions.locator('li[data-confidence="confirmed"]').count(),
    ).toBe(0);
    await expect(suspicions.getByTestId('confidence').first()).toContainText(
      'not confirmed',
    );
    await expect(
      page.getByTestId('finding-finding-12').getByTestId('no-evidence'),
    ).toContainText('No evidence was recorded');
  });

  test('links the advisory and the code, and narrows by severity and repository', async ({
    page,
  }) => {
    await open(page, '/security');
    const served = await fetchJson<{ items: Served[] }>(
      page,
      '/findings?limit=200',
    );
    const withAdvisory = served.items.find(({ advisoryUrl }) => advisoryUrl);
    expect(withAdvisory).toBeTruthy();
    await expect(
      page.getByTestId(`finding-${withAdvisory!.id}`).getByTestId('advisory'),
    ).toHaveAttribute('href', withAdvisory!.advisoryUrl!);
    await expect(
      page.getByTestId('finding-finding-2').getByTestId('finding-code'),
    ).toHaveAttribute(
      'href',
      /github\.com\/forgemind\/api\/blob\/.+\/package\.json#L22$/,
    );

    await page.getByTestId('finding-severity-filter').click();
    await page.getByRole('option', { name: 'critical' }).click();
    const critical = served.items.filter(
      ({ severity, status }) => severity === 'critical' && status === 'open',
    ).length;
    await expect(page.getByTestId('finding-count')).toHaveText(
      new RegExp(`^${critical} of `),
    );

    await page.getByTestId('finding-severity-filter').click();
    await page.getByRole('option', { name: 'All severities' }).click();
    await page.getByTestId('finding-repository-filter').click();
    await page.getByRole('option', { name: 'forgemind/web' }).click();
    const onWeb = served.items.filter(
      ({ repositoryId, status }) =>
        repositoryId === 'repo-2' && status === 'open',
    ).length;
    await expect(page.getByTestId('finding-count')).toHaveText(
      new RegExp(`^${onWeb} of `),
    );

    await page.getByTestId('show-fixed').click();
    await page.getByTestId('finding-repository-filter').click();
    await page.getByRole('option', { name: 'All repositories' }).click();
    await expect(page.getByTestId('finding-count')).toHaveText(
      `${served.items.length} of ${served.items.length}`,
    );
  });

  test('has no axe violations', async ({ page }) => {
    await open(page, '/security');
    await expect(page.getByTestId('findings-confirmed')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
});
