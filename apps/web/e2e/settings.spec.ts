import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { axeViolations } from './support/axe';
import { open } from './support/open';

const api = 'http://localhost:4110';

const signInAs = async (context: BrowserContext, token: string) => {
  await context.clearCookies();
  await context.addCookies([
    { name: 'fm_session', value: token, domain: 'localhost', path: '/' },
  ]);
};

const members = async (page: Page) =>
  (await (await page.request.get(`${api}/organization/members`)).json()) as {
    user: { id: string; name: string };
    role: string;
  }[];

test.describe('settings', () => {
  test('an owner sees the organization, every member with a role control, and can invite and revoke, with confirmation', async ({
    page,
  }) => {
    await open(page, '/settings');
    await expect(page.getByTestId('settings')).toHaveAttribute(
      'data-role',
      'owner',
    );
    await expect(page.getByTestId('organization-settings')).toContainText(
      'Ayinde Creations',
    );

    const before = await members(page);
    await expect(page.getByTestId('members')).toContainText(
      `Members (${before.length})`,
    );
    const owner = before.find(({ role }) => role === 'owner')!;
    // The only owner keeps the role: a badge, not a control.
    await expect(page.getByTestId(`role-${owner.user.id}`)).toHaveText('Owner');
    await expect(page.getByTestId(`remove-${owner.user.id}`)).toHaveCount(0);

    await page.getByTestId('invite-member').click();
    await page.getByTestId('invite-name').fill('Temp Reviewer');
    await page.getByTestId('invite-email').fill('temp.reviewer@example.com');
    await page.getByTestId('invite-role').click();
    await page.getByRole('option', { name: 'Reviewer' }).click();
    await page.getByTestId('send-invite').click();
    await expect(page.getByTestId('members')).toContainText(
      `Members (${before.length + 1})`,
    );
    const added = (await members(page)).find(
      ({ user }) => user.name === 'Temp Reviewer',
    )!;
    expect(added.role).toBe('reviewer');
    await expect(
      page.getByTestId('audit-log').getByTestId('audit-entry').first(),
    ).toContainText('invited a member');

    await page.getByTestId(`role-${added.user.id}`).click();
    await page.getByRole('option', { name: 'Viewer', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await members(page)).find(({ user }) => user.id === added.user.id)
            ?.role,
      )
      .toBe('viewer');

    await page.getByTestId(`remove-${added.user.id}`).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('signed out everywhere');
    await confirm.getByRole('button', { name: 'Revoke access' }).click();
    await expect(page.getByTestId(`member-${added.user.id}`)).toHaveCount(0);
    expect(
      (await members(page)).some(({ user }) => user.id === added.user.id),
    ).toBe(false);
  });

  test('revoking a repository asks first and takes effect', async ({
    page,
  }) => {
    const connected = await page.request.post(`${api}/repositories`, {
      data: { githubId: 811007, fullName: 'forgemind/infra' },
    });
    expect(connected.ok()).toBe(true);
    const repo = (await connected.json()) as { id: string };

    await open(page, '/settings');
    await page
      .getByTestId('repository-access')
      .getByTestId(`revoke-${repo.id}`)
      .click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Revoke access' })
      .click();
    await expect(page.getByTestId(`revoke-${repo.id}`)).toHaveCount(0);
    const after = (await (
      await page.request.get(`${api}/repositories/${repo.id}`)
    ).json()) as { status: string };
    expect(after.status).toBe('revoked');
  });

  test('a reviewer sees members but no way to manage them or revoke anything', async ({
    page,
    context,
  }) => {
    await signInAs(context, 'dev-reviewer');
    await open(page, '/settings');
    await expect(page.getByTestId('settings')).toHaveAttribute(
      'data-role',
      'reviewer',
    );
    await expect(page.getByTestId('members')).toContainText('Members (');
    await expect(page.getByTestId('invite-member')).toHaveCount(0);
    expect(await page.locator('[data-testid^="remove-"]').count()).toBe(0);
    expect(await page.locator('[data-testid^="revoke-"]').count()).toBe(0);
    expect(await page.getByRole('combobox').count()).toBe(0);
    await expect(page.getByTestId('appearance')).toBeVisible();
    await expect(page.getByTestId('audit-log')).toBeVisible();
  });

  test('has no axe violations', async ({ page }) => {
    await open(page, '/settings');
    await expect(page.getByTestId('audit-log')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
});
