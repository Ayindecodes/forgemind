import { endpoints, PullRequest, Run, Task } from '@forgemind/contract';
import { describe, expect, it } from 'vitest';

import { createApp } from './app';
import { createStore } from './store';

const clock = () => new Date('2026-11-02T12:00:00Z');

function harness(speed = Infinity) {
  const store = createStore({
    speed,
    now: speed === Infinity ? clock : undefined,
  });
  const app = createApp(store);
  const json = async (path: string, init: RequestInit = {}) => {
    const response = await app.request(path, {
      ...init,
      headers: {
        cookie: 'fm_session=dev-owner',
        ...(init.headers as Record<string, string>),
      },
    });
    return { status: response.status, body: await response.json() };
  };
  const post = (path: string, body?: unknown) =>
    json(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { store, app, json, post };
}

const newTask = (title = 'Fix the retry budget', category = 'fix_bug') => ({
  repositoryId: 'repo-1',
  title,
  request: 'Please fix it.',
  category,
});

describe('a task from creation to pull request', () => {
  it('runs, waits for approval, and opens a pull request once approved', async () => {
    const { json, post } = harness();

    const created = await post('/tasks', newTask());
    expect(created.status).toBe(201);
    const task = Task.parse(created.body);
    expect(task.status).toBe('awaiting_approval');

    const run = Run.parse((await json(`/runs/${task.runId}`)).body);
    expect(run.outcome).toBe('succeeded');
    expect(run.verification).toBe('verified');

    const pending = await post(`/tasks/${task.id}/pull-request`);
    expect(pending.status).toBe(409);

    const approved = Task.parse((await post(`/tasks/${task.id}/approve`)).body);
    expect(approved).toMatchObject({
      status: 'completed',
      decision: 'approved',
    });
    expect(Run.parse((await json(`/runs/${task.runId}`)).body).status).toBe(
      'completed',
    );

    const opened = await post(`/tasks/${task.id}/pull-request`);
    expect(opened.status).toBe(201);
    const pr = PullRequest.parse(opened.body);
    expect(pr).toMatchObject({ taskId: task.id, state: 'open' });

    expect((await post(`/tasks/${task.id}/pull-request`)).status).toBe(409);
    expect((await post(`/tasks/${task.id}/approve`)).status).toBe(409);

    const list = endpoints.pullRequests.response.parse(
      (await json('/pull-requests')).body,
    );
    expect(list.items[0]?.id).toBe(pr.id);
  });

  it('can be rejected, and a rejected task cannot open a pull request', async () => {
    const { post } = harness();
    const task = Task.parse((await post('/tasks', newTask())).body);

    const rejected = Task.parse((await post(`/tasks/${task.id}/reject`)).body);
    expect(rejected).toMatchObject({
      status: 'completed',
      decision: 'rejected',
    });
    expect((await post(`/tasks/${task.id}/pull-request`)).status).toBe(409);
  });

  it('starts a new run when a revision is requested and keeps the old one', async () => {
    const { json, post } = harness();
    const task = Task.parse((await post('/tasks', newTask())).body);

    const revised = Task.parse(
      (
        await post(`/tasks/${task.id}/revise`, {
          instructions: 'Keep the old API too.',
        })
      ).body,
    );
    expect(revised.runId).not.toBe(task.runId);
    expect(revised.decision).toBe('revision_requested');
    expect(revised.status).toBe('awaiting_approval');

    const runs = endpoints.taskRuns.response.parse(
      (await json(`/tasks/${task.id}/runs`)).body,
    );
    expect(runs.map(({ id, status }) => [id, status])).toEqual([
      [task.runId, 'completed'],
      [revised.runId, 'awaiting_approval'],
    ]);
  });

  it('ends unverified when a title asks for it, and the report says what did not run', async () => {
    const { json, post } = harness();
    const task = Task.parse(
      (await post('/tasks', newTask('Upgrade deps (unverified)'))).body,
    );
    const run = Run.parse((await json(`/runs/${task.runId}`)).body);

    expect(run.outcome).toBe('unverified');
    expect(
      run.stages.find(({ id }) => id === 'implementation')?.attempts,
    ).toHaveLength(2);

    const report = endpoints.runReport.response.parse(
      (await json(`/runs/${task.runId}/report`)).body,
    );
    expect(report.outcome).toBe('unverified');
    expect(report.unresolved.join(' ')).toMatch(/Build did not pass/);
    expect(report.filesModified).toEqual([
      'src/retry.ts',
      'tests/retry.test.ts',
      'src/types.ts',
    ]);
  });

  it('serves a diff with real patches for the changed files', async () => {
    const { json, post } = harness();
    const task = Task.parse((await post('/tasks', newTask())).body);
    const diff = endpoints.runDiff.response.parse(
      (await json(`/runs/${task.runId}/diff`)).body,
    );

    expect(diff.files.map(({ path }) => path)).toEqual([
      'src/retry.ts',
      'tests/retry.test.ts',
      'src/types.ts',
    ]);
    expect(diff.files[0]?.patch).toContain('@@');
    expect(diff.files.reduce((sum, file) => sum + file.additions, 0)).toBe(
      Run.parse((await json(`/runs/${task.runId}`)).body).diff?.additions,
    );
  });

  it('refuses to report on a run that has not finished', async () => {
    const { json } = harness(1000);
    const response = await json('/runs/run-10/report');

    expect(response.status).toBe(409);
  });
});

describe('cancelling a live run', () => {
  it('stops the scenario and records the cancellation', async () => {
    const { json, post } = harness(1000);
    const task = Task.parse((await post('/tasks', newTask())).body);
    // The first event is scheduled, not emitted, so a new task starts queued.
    expect(task.status).toBe('queued');

    const cancelled = Task.parse((await post(`/tasks/${task.id}/cancel`)).body);
    expect(cancelled.status).toBe('cancelled');

    const run = Run.parse((await json(`/runs/${task.runId}`)).body);
    expect(run.status).toBe('cancelled');
    expect(run.outcome).toBeNull();

    const events = async () =>
      endpoints.runEvents.response.parse(
        (await json(`/runs/${task.runId}/events`)).body,
      );
    const count = (await events()).length;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect((await events()).length).toBe(count);
    expect((await post(`/tasks/${task.id}/cancel`)).status).toBe(409);
  });
});

describe('repositories', () => {
  it('connect, analyse, and can be disconnected', async () => {
    const { json, post } = harness();
    const connected = await post('/repositories', {
      githubId: 999,
      fullName: 'acme/new',
    });
    expect(connected.status).toBe(201);
    const repo = endpoints.repository.response.parse(connected.body);
    expect(repo.status).toBe('connected');
    expect((await json(`/repositories/${repo.id}/analysis`)).status).toBe(200);

    expect(
      (await post('/repositories', { githubId: 999, fullName: 'acme/new' }))
        .status,
    ).toBe(409);

    const removed = await json(`/repositories/${repo.id}`, {
      method: 'DELETE',
    });
    expect(removed.status).toBe(200);
    expect(
      endpoints.repository.response.parse(
        (await json(`/repositories/${repo.id}`)).body,
      ).status,
    ).toBe('revoked');
  });
});
