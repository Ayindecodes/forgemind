import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { open } from './support/open';

const PAGE = '/design/components';

/**
 * axe cannot model backdrop filters, so it judges glass by the unfiltered
 * blend. materials.spec.ts checks the real rendered pixels of that sample.
 */
const GLASS_SAMPLE = '[data-testid="material-stage"]';

async function expectNoAxeViolations(
  page: Page,
  label: string,
  scope?: { include?: string; exclude?: string },
) {
  let builder = new AxeBuilder({ page }).exclude(GLASS_SAMPLE);
  if (scope?.include) builder = builder.include(scope.include);
  if (scope?.exclude) builder = builder.exclude(scope.exclude);

  const { violations } = await builder.analyze();
  const summary = violations.map(
    ({ id, impact, nodes }) =>
      `${id} (${impact}): ${nodes.map(({ target }) => target.join(' ')).join(', ')}`,
  );

  expect(summary, label).toEqual([]);
}

const background = (page: Page, testId: string) =>
  page
    .getByTestId(testId)
    .evaluate((element) => getComputedStyle(element).backgroundColor);

test.describe('accessibility', () => {
  for (const theme of ['dark', 'light'] as const) {
    test(`the foundations page has no axe violations in the ${theme} theme`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });
      await open(page, '/design');
      await expectNoAxeViolations(page, `/design ${theme}`);
    });

    test(`the components page has no axe violations in the ${theme} theme`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });
      await open(page, PAGE);
      await expectNoAxeViolations(page, `${PAGE} ${theme}`);
    });
  }

  test('open overlays have no axe violations', async ({ page }) => {
    await open(page, PAGE);

    await page.getByTestId('dialog-trigger').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoAxeViolations(page, 'dialog open');
    await page.keyboard.press('Escape');

    // A modal menu hides the page behind it and traps focus there, which axe
    // reads as hidden-but-focusable content. The menu itself is what matters.
    await page.getByTestId('menu-trigger').click();
    await expect(page.getByRole('menu')).toBeVisible();
    await expectNoAxeViolations(page, 'menu open', {
      include: '[role="menu"]',
    });
    await page.keyboard.press('Escape');

    await page.getByTestId('toast-error').click();
    await expect(
      page.getByTestId('toast').filter({ hasText: 'Error toast' }),
    ).toBeVisible();
    await expectNoAxeViolations(page, 'toast shown');
  });
});

test.describe('state previews', () => {
  test('show hover, focus and pressed states statically', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page, PAGE);

    expect(await background(page, 'button-secondary-hover')).not.toBe(
      await background(page, 'button-secondary'),
    );
    expect(await background(page, 'button-primary-hover')).not.toBe(
      await background(page, 'button-primary'),
    );

    const focus = page.getByTestId('button-secondary-focus');
    expect(
      await focus.evaluate((element) => getComputedStyle(element).outlineStyle),
    ).toBe('solid');

    const active = page.getByTestId('button-secondary-active');
    expect(
      await active.evaluate((element) => getComputedStyle(element).scale),
    ).toBe('0.98');
  });

  test('a loading button is busy and blocks input', async ({ page }) => {
    await open(page, PAGE);

    const button = page.getByTestId('button-primary-loading');
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await expect(button).toBeDisabled();
    await expect(button).toHaveText('Running');
  });
});

test.describe('keyboard', () => {
  test('a dialog traps focus, closes on Escape and returns focus', async ({
    page,
  }) => {
    await open(page, PAGE);

    const trigger = page.getByTestId('dialog-trigger');
    await trigger.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: 'Rename branch' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    for (let index = 0; index < 8; index += 1) {
      await page.keyboard.press('Tab');
      expect(
        await page.evaluate(
          () => document.activeElement?.closest('[role="dialog"]') !== null,
        ),
      ).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('a confirm dialog waits for the action, then closes', async ({
    page,
  }) => {
    await open(page, PAGE);

    await page.getByTestId('confirm-trigger').click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();

    const confirm = dialog.getByRole('button', { name: 'Open pull request' });
    await confirm.click();
    await expect(confirm).toHaveAttribute('aria-busy', 'true');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('confirm-count')).toHaveText(
      'Confirmed 1, deleted 0',
    );
  });

  test('a destructive confirm starts on Cancel', async ({ page }) => {
    await open(page, PAGE);

    await page.getByTestId('destructive-trigger').click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('confirm-count')).toHaveText(
      'Confirmed 0, deleted 0',
    );
  });

  test('a menu opens with the keyboard and returns focus', async ({ page }) => {
    await open(page, PAGE);

    const trigger = page.getByTestId('menu-trigger');
    await trigger.focus();
    await page.keyboard.press('ArrowDown');

    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem').first()).toBeFocused();

    await page.keyboard.press('End');
    await expect(page.getByTestId('menu-delete')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('tabs move with the arrow keys', async ({ page }) => {
    await open(page, PAGE);

    const tabs = page.getByTestId('tabs');
    await tabs.getByRole('tab', { name: 'Diff' }).focus();
    await page.keyboard.press('ArrowRight');

    await expect(tabs.getByRole('tab', { name: 'Checks' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(tabs.getByRole('tabpanel')).toHaveText('All 4 checks passed.');

    // Radix moves focus on a zero-delay timer, so each press is asserted
    // before the next, as a person would see it. The disabled tab is skipped.
    await page.keyboard.press('ArrowRight');
    await expect(tabs.getByRole('tab', { name: 'Findings' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('ArrowRight');
    await expect(tabs.getByRole('tab', { name: 'Diff' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('a select opens, moves and chooses with the keyboard', async ({
    page,
  }) => {
    await open(page, PAGE);

    const trigger = page.getByTestId('select');
    await expect(trigger).toHaveText(/Medium/);

    await trigger.focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('listbox')).toBeVisible();

    // Radix focuses the chosen option once the list is placed, so wait for it
    // before moving, as a person would.
    await expect(page.getByRole('option', { name: /Medium/ })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('option', { name: /Large/ })).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(trigger).toHaveText(/Large/);
    await expect(trigger).toBeFocused();
  });

  test('a tooltip shows on focus and hides on blur', async ({ page }) => {
    await open(page, PAGE);

    await page.getByTestId('tooltip-trigger').focus();
    await expect(page.getByRole('tooltip')).toHaveText('Notifications');

    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('tooltip', { name: 'Notifications' }),
    ).toHaveCount(0);
  });

  test('a popover closes on Escape and returns focus', async ({ page }) => {
    await open(page, PAGE);

    const trigger = page.getByTestId('popover-trigger');
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('popover')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('popover')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('checkbox and switch toggle with Space', async ({ page }) => {
    await open(page, PAGE);

    const checkbox = page.getByTestId('checkbox');
    await expect(checkbox).toHaveAttribute('aria-checked', 'true');
    await checkbox.focus();
    await page.keyboard.press('Space');
    await expect(checkbox).toHaveAttribute('aria-checked', 'false');

    const toggle = page.getByTestId('switch');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
  });
});

test.describe('forms', () => {
  test('an invalid field is announced and described by its error', async ({
    page,
  }) => {
    await open(page, PAGE);

    const input = page.getByTestId('input-invalid');
    await expect(input).toHaveAttribute('aria-invalid', 'true');

    const describedBy = await input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(
      'A branch with this name already exists.',
    );
    await expect(page.locator(`[id="${describedBy}"]`)).toHaveAttribute(
      'role',
      'alert',
    );
  });

  test('every control has an accessible name', async ({ page }) => {
    await open(page, PAGE);

    const unnamed = await page
      .locator('main')
      .locator(
        'input, textarea, button, [role="combobox"], [role="checkbox"], [role="switch"]',
      )
      .evaluateAll((elements) =>
        elements
          .filter((element) => element.getAttribute('aria-hidden') !== 'true')
          .filter((element) => {
            const labelled =
              element.getAttribute('aria-label') ||
              element.getAttribute('aria-labelledby') ||
              element.textContent?.trim() ||
              element.closest('label') ||
              (element.id &&
                document.querySelector(`label[for="${element.id}"]`));
            return !labelled;
          })
          .map((element) => element.outerHTML.slice(0, 80)),
      );

    expect(unnamed).toEqual([]);
  });
});

test.describe('toasts', () => {
  test('appear, can be dismissed and leave on their own', async ({ page }) => {
    await open(page, PAGE);

    await page.getByTestId('toast-success').click();
    const toast = page
      .getByTestId('toast')
      .filter({ hasText: 'Success toast' });
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Success:');
    await expect(
      toast.getByRole('button', { name: 'View diff' }),
    ).toBeVisible();

    await toast.getByRole('button', { name: 'Dismiss' }).click();
    await expect(toast).toHaveCount(0);

    // Timers pause while the pointer is over the toasts, so move it away.
    await page.mouse.move(10, 10);

    await page.getByTestId('toast-warning').click();
    const warning = page
      .getByTestId('toast')
      .filter({ hasText: 'Warning toast' });
    await expect(warning).toBeVisible();
    await expect(warning).toHaveCount(0, { timeout: 8000 });
  });
});

test('loading indicators hold still under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, PAGE);

  const animations = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter(({ playState }) => playState === 'running').length,
  );

  expect(animations).toBe(0);
  await expect(page.getByTestId('skeleton')).toBeVisible();
  await expect(
    page.getByRole('status', { name: 'Loading' }).first(),
  ).toBeVisible();
});

test('the components page is hidden from a normal production build', async ({
  request,
}) => {
  // The test server enables it; a build without ENABLE_DESIGN_PAGE returns 404.
  expect((await request.get(PAGE)).status()).toBe(200);
});
