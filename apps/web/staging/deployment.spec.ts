import { expect, test, type Page } from '@playwright/test';

/*
 * What a deployment is for, done the way a person does it: sign in with
 * GitHub, connect a repository, look at what ForgeMind found in it. The
 * steps hold whether the person is new to the deployment or has been here
 * before, so they can be repeated against one that keeps its data.
 *
 *   STAGING_REPOSITORY         the repository to connect, as owner/name
 *   STAGING_REPOSITORY_COMMIT  the commit its analysis must be of (optional)
 *   STAGING_REPOSITORY_SHOWS   texts the analysis must hold, comma-separated
 *                              (optional)
 *   STAGING_FINDING            a finding the Security page must show, as
 *                              path:line (optional)
 *   STAGING_FINDING_COMMIT     the commit that line is a line of
 *   STAGING_FINDING_FIXED      the commit that no longer has it, if it is
 *                              closed (optional)
 *   STAGING_PERSON             who signs in; Sam Rivera unless given
 */
const person = process.env.STAGING_PERSON ?? 'Sam Rivera';
const repository = process.env.STAGING_REPOSITORY ?? '';
const commit = process.env.STAGING_REPOSITORY_COMMIT;
const shows = (process.env.STAGING_REPOSITORY_SHOWS ?? '')
  .split(',')
  .filter(Boolean);
const finding = process.env.STAGING_FINDING;
const findingCommit = process.env.STAGING_FINDING_COMMIT ?? '';
const fixedAt = process.env.STAGING_FINDING_FIXED;

async function onSimulatedGitHub(page: Page) {
  await expect(page.getByRole('note')).toContainText('Simulated GitHub');
}

test('a person signs in with GitHub, connects a repository and inspects it', async ({
  page,
  request,
  baseURL,
}) => {
  expect(repository, 'STAGING_REPOSITORY names the repository').toMatch(
    /^[\w.-]+\/[\w.-]+$/,
  );
  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({
    status: 'ok',
    environment: 'staging',
  });
  // Nothing here is the demonstration data of the development API.
  expect(health.headers()['x-forgemind-data']).toBe('live');
  test.skip(
    health.headers()['x-forgemind-github'] !== 'simulated',
    'GitHub itself is not signed in to by a script; do these steps by hand',
  );

  // Everything the page asks for, to see that none of it leaves the address.
  const asked: string[] = [];
  page.on('request', (sent) => asked.push(sent.url()));

  // Step 1: sign in. A visit without a session is sent to do that first.
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(
    page.getByRole('heading', { name: 'Sign in to ForgeMind' }),
  ).toBeVisible();
  await page.getByTestId('sign-in-github').click();
  await onSimulatedGitHub(page);
  await page
    .getByRole('link', { name: new RegExp(`Authorize as ${person}`) })
    .click();
  // Back from GitHub, the page that takes the answer sends the person on.
  await page.waitForURL(
    (url) => !/^\/(sign-in|api|auth)(\/|$)/.test(url.pathname),
  );

  // Step 2: connect the repository. Someone new is taken through it.
  if (new URL(page.url()).pathname === '/onboarding') {
    await expect(page.getByTestId('onboarding-organization')).toBeVisible();
    await page.getByTestId('organization-name').fill('Staging check');
    await page.getByRole('button', { name: 'Create organization' }).click();

    const install = page.getByTestId('onboarding-install');
    await expect(install).toContainText('Never the default branch');
    await page.getByTestId('install-github').click();
    await onSimulatedGitHub(page);
    await page.getByRole('link', { name: 'Install' }).click();

    const choose = page.getByTestId('onboarding-repositories');
    await choose
      .getByRole('listitem')
      .filter({ hasText: repository })
      .getByRole('checkbox')
      .click();
    await page.getByTestId('connect-repositories').click();

    // A worker clones and reads it; this waits for that to have happened.
    const done = page.getByTestId('onboarding-done');
    await expect(done).toContainText(repository);
    await expect(done.getByText('Indexed and ready')).toBeVisible({
      timeout: 60_000,
    });
    await page.getByTestId('open-repository').click();
  } else {
    await page.goto('/repositories');
    await page.getByRole('link', { name: repository }).first().click();
  }

  // The inspection: what was found, and in which commit.
  await expect(page).toHaveURL(/\/repositories\/[\w-]+$/);
  const analysis = page.getByTestId('analysis');
  await expect(analysis).toBeVisible({ timeout: 60_000 });
  if (commit) await expect(analysis).toHaveAttribute('data-commit', commit);
  for (const title of ['Languages', 'Dependencies', 'Tests and builds']) {
    await expect(analysis.locator(`[data-row="${title}"]`)).toBeVisible();
  }
  for (const text of shows) await expect(analysis).toContainText(text);

  // The session is kept by the browser: it is still there after a reload.
  await page.reload();
  await expect(page.getByTestId('analysis')).toBeVisible();

  // What a scan raised: at the commit and the line it was found at, and,
  // once a later commit no longer has it, closed at that commit.
  if (finding) {
    expect(findingCommit, 'STAGING_FINDING_COMMIT names a commit').toMatch(
      /^[0-9a-f]{40}$/,
    );
    const [path, line] = finding.split(':');
    await page.goto('/security');
    if (fixedAt) await page.getByTestId('show-fixed').click();
    const card = page
      .getByTestId(/^finding-[0-9a-f-]{36}$/)
      .filter({ hasText: finding });
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId('finding-commit')).toHaveText(
      findingCommit.slice(0, 7),
    );
    await expect(card.getByTestId('finding-code')).toHaveAttribute(
      'href',
      new RegExp(`/blob/${findingCommit}/${path}#L${line}$`),
    );
    if (fixedAt) {
      await expect(card.getByTestId('fixed-commit')).toHaveText(
        `no longer found at ${fixedAt.slice(0, 7)}`,
      );
    } else {
      await expect(card.getByTestId('fixed-commit')).toHaveCount(0);
    }
  }

  const origin = new URL(baseURL!).origin;
  const elsewhere = asked.filter(
    (url) => /^https?:/.test(url) && new URL(url).origin !== origin,
  );
  expect(elsewhere, 'requests that left the deployment').toEqual([]);
  expect(asked.some((url) => url.startsWith(`${origin}/api/`))).toBe(true);
});
