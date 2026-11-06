import { expect, test, type Page } from '@playwright/test';

import { axeViolations } from './support/axe';
import { open } from './support/open';

const api = 'http://localhost:4110';

const feedOf = (page: Page) => page.getByTestId('run-workspace');

/** The count and the last sequence number, read in one go. */
const progress = (page: Page) =>
  feedOf(page).evaluate((element) => ({
    count: Number(element.dataset.eventCount),
    lastSeq: Number(element.dataset.lastSeq),
    connection: element.dataset.connection,
  }));

const serverLastSeq = async (page: Page, runId: string) => {
  const events = (await (
    await page.request.get(`${api}/runs/${runId}/events`)
  ).json()) as { seq: number }[];
  return events.at(-1)?.seq ?? 0;
};

test.describe('the live event layer', () => {
  test('follows a run, survives a dropped connection, and loses nothing', async ({
    page,
    context,
  }) => {
    const created = await page.request.post(`${api}/tasks`, {
      data: {
        repositoryId: 'repo-1',
        title: 'Check the live layer',
        request: 'Stream every event to the browser.',
        category: 'fix_bug',
      },
    });
    expect(created.ok()).toBe(true);
    const task = (await created.json()) as { id: string; runId: string };

    await open(page, `/tasks/${task.id}`);
    const feed = feedOf(page);
    await expect(feed).toHaveAttribute('data-connection', 'live');
    await expect
      .poll(async () => (await progress(page)).count, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(6);

    // Take the network away while the run goes on without us, then give it
    // back. The client must pick up exactly the events it missed.
    await context.setOffline(true);
    await expect(feed).toHaveAttribute('data-connection', 'reconnecting');
    await page.waitForTimeout(3000);
    await context.setOffline(false);
    await expect(feed).toHaveAttribute('data-connection', 'live', {
      timeout: 20_000,
    });

    // Events keep coming, and the sequence has no gap and no duplicate: the
    // count equals the last sequence number only if every number is there once.
    const before = await progress(page);
    await expect
      .poll(async () => (await progress(page)).count, { timeout: 30_000 })
      .toBeGreaterThan(before.count);
    const serverSeq = await serverLastSeq(page, task.runId);
    await expect
      .poll(async () => (await progress(page)).lastSeq, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(serverSeq);
    const after = await progress(page);
    expect(after.count).toBe(after.lastSeq);

    await page.getByRole('tab', { name: /^Events/ }).click();
    await expect(feed.getByRole('list', { name: 'Events' })).toBeVisible();
    await expect(feed.getByText('Attempt 1 of')).toBeVisible();
  });

  test('replays a finished run and says the stream has ended', async ({
    page,
  }) => {
    await open(page, '/tasks/task-5');
    const feed = feedOf(page);
    await expect(feed).toHaveAttribute('data-connection', 'ended');
    await expect(feed.getByText('Stream ended')).toBeVisible();

    const task = (await (
      await page.request.get(`${api}/tasks/task-5`)
    ).json()) as { runId: string };
    const state = await progress(page);
    expect(state.count).toBe(state.lastSeq);
    expect(state.lastSeq).toBe(await serverLastSeq(page, task.runId));

    await expect(feed.locator('[data-status="failed"]').first()).toBeVisible();
    await expect(feed.getByText(/^Finished/)).toBeVisible();
  });

  test('keeps agent notes apart from what actually ran', async ({ page }) => {
    await open(page, '/tasks/task-2');
    const feed = feedOf(page);
    await expect(feed).toHaveAttribute('data-connection', 'live');
    await expect(feed.getByText('Waiting for a decision')).toBeVisible();

    await page.getByRole('tab', { name: /^Events/ }).click();
    const notes = feed.locator('li[data-kind="note"]');
    await expect(notes.first()).toBeVisible();
    await expect(notes.first().getByText('Agent note')).toBeVisible();
    expect(
      await feed.locator('li[data-kind="execution"]').count(),
    ).toBeGreaterThan(await notes.count());
  });

  test('the task page has no axe violations with a live feed', async ({
    page,
  }) => {
    await open(page, '/tasks/task-2');
    await expect(feedOf(page)).toHaveAttribute('data-connection', 'live');
    expect(await axeViolations(page)).toEqual([]);
  });
});
