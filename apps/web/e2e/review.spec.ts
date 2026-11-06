import { expect, test } from '@playwright/test';

import { axeViolations } from './support/axe';
import { open } from './support/open';

test.describe('the code review workspace', () => {
  test('lists the changed files and shows one diff with real hunks', async ({
    page,
  }) => {
    await open(page, '/tasks/task-2/review');
    const workspace = page.getByTestId('review-workspace');
    await expect(workspace).toHaveAttribute('data-files', '3');
    await expect(workspace).toHaveAttribute('data-selected', 'src/retry.ts');

    const tree = page.getByTestId('file-tree');
    await expect(tree.getByTestId('file-src/retry.ts')).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(tree.getByTestId('file-tests/retry.test.ts')).toContainText(
      '+42',
    );

    const diff = page.getByTestId('diff-file');
    await expect(diff).toHaveAttribute('data-path', 'src/retry.ts');
    await expect(diff.locator('.diff-code-insert').first()).toBeVisible();
    await expect(diff.locator('.diff-code-delete').first()).toBeVisible();
    await expect(diff).toContainText('@@ -34');
    // Highlighted with the same tokens as every code block.
    await expect(
      diff.locator('.diff-code span[style*="color"]').first(),
    ).toBeVisible();

    await tree.getByTestId('file-tests/retry.test.ts').click();
    await expect(page.getByTestId('diff-file')).toHaveAttribute(
      'data-path',
      'tests/retry.test.ts',
    );
  });

  test('switches between split and unified layouts', async ({ page }) => {
    await open(page, '/tasks/task-2/review');
    const diff = page.getByTestId('diff-file');
    await expect(diff).toHaveAttribute('data-view', 'split');
    await page.getByTestId('view-unified').click();
    await expect(diff).toHaveAttribute('data-view', 'unified');
    await expect(page.getByTestId('view-unified')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('selecting a finding opens the exact line', async ({ page }) => {
    await open(page, '/tasks/task-4/review');
    const workspace = page.getByTestId('review-workspace');
    await expect(workspace).toHaveAttribute('data-files', '2');

    const finding = page.getByTestId('finding-finding-2');
    await expect(finding).toHaveAttribute('data-placement', 'in-patch');
    await expect(finding).toContainText('package.json:22');
    await finding.getByTestId('show-finding').click();

    await expect(workspace).toHaveAttribute('data-selected', 'package.json');
    await expect(page).toHaveURL(/#package\.json:L22$/);
    const selected = page.locator('.diff-gutter-selected').first();
    await expect(selected).toBeVisible();
    await expect(selected).toHaveText('22');
    await expect(page.locator('.diff-code-selected').first()).toContainText(
      'jsonwebtoken',
    );
  });

  test('opens on the line the URL names', async ({ page }) => {
    await open(page, '/tasks/task-4/review#package.json:L24');
    await expect(page.getByTestId('review-workspace')).toHaveAttribute(
      'data-selected',
      'package.json',
    );
    await expect(page.locator('.diff-code-selected').first()).toContainText(
      'lodash',
    );
  });

  test('says when evidence is missing or a finding falls outside the patch', async ({
    page,
  }) => {
    await open(page, '/tasks/task-2/review');
    const finding = page.getByTestId('finding-finding-12');
    await expect(finding).toHaveAttribute(
      'data-placement',
      'line-not-in-patch',
    );
    await expect(finding.getByTestId('missing-evidence')).toContainText(
      'No evidence was recorded by review-agent',
    );
    await expect(finding.getByTestId('placement')).toContainText(
      'outside the lines the patch touches',
    );
    await expect(finding.getByTestId('show-finding')).toHaveCount(0);
    await expect(page.getByTestId('evidence')).toContainText(
      'All 3 required checks ran and passed',
    );
  });

  test('drafts inline comments that become the revision instructions', async ({
    page,
  }) => {
    await open(page, '/tasks/task-2/review');
    const diff = page.getByTestId('diff-file');
    await diff
      .locator('.diff-gutter')
      .filter({ hasText: /^41$/ })
      .first()
      .click();
    await page.getByTestId('comment-text').fill('Keep the old guard as well.');
    await page.getByTestId('save-comment').click();

    await expect(page.getByTestId('comment')).toHaveCount(1);
    await expect(page.getByTestId('draft-count')).toHaveText('1 draft comment');
    await expect(page.getByTestId('file-src/retry.ts')).toContainText('1');

    await page.reload();
    await page.waitForSelector('html[data-hydrated]');
    await expect(page.getByTestId('comment')).toHaveCount(1);

    await page.getByTestId('request-changes').click();
    await expect(page.getByTestId('revision-instructions')).toHaveValue(
      /src\/retry\.ts:\n {2}line 41: Keep the old guard as well\./,
    );
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Delete comment' }).click();
    await expect(page.getByTestId('comment')).toHaveCount(0);
  });

  test('on a phone it reviews one file at a time', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '/tasks/task-2/review');
    const tabs = page.getByTestId('review-tabs');
    await expect(tabs.getByRole('tab', { name: 'Files (3)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByTestId('diff-file')).toHaveCount(0);

    await page.getByTestId('file-src/types.ts').click();
    await expect(page.getByTestId('diff-file')).toHaveAttribute(
      'data-path',
      'src/types.ts',
    );
    await expect(page.getByTestId('diff-file')).toHaveAttribute(
      'data-view',
      'unified',
    );
    await expect(page.getByTestId('diff-file')).toHaveCount(1);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await page.getByTestId('back-to-files').click();
    await expect(page.getByTestId('diff-file')).toHaveCount(0);
  });

  test('is reachable from the run page', async ({ page }) => {
    await open(page, '/tasks/task-2');
    await page.getByTestId('review-patch').click();
    await expect(page).toHaveURL(/\/tasks\/task-2\/review$/);
    await expect(page.getByTestId('review-workspace')).toBeVisible();
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`has no axe violations in the ${theme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await open(page, '/tasks/task-4/review');
      await expect(page.getByTestId('diff-file')).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
    });
  }
});
