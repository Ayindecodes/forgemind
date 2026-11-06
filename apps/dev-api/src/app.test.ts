import {
  ApiError,
  buildPath,
  DATA_SOURCE_HEADER,
  endpoints,
  type EndpointKey,
} from '@forgemind/contract';
import { describe, expect, it } from 'vitest';

import { createApp } from './app';
import { createStore } from './store';

const clock = () => new Date('2026-11-02T12:00:00Z');
const OWNER = { headers: { cookie: 'fm_session=dev-owner' } };

function instant() {
  const store = createStore({ speed: Infinity, now: clock });
  return { store, app: createApp(store) };
}

const seededParams: Partial<Record<EndpointKey, Record<string, string>>> = {
  repository: { id: 'repo-1' },
  repositoryAnalysis: { id: 'repo-1' },
  task: { id: 'task-2' },
  taskRuns: { id: 'task-2' },
  run: { id: 'run-2' },
  runEvents: { id: 'run-2' },
  runDiff: { id: 'run-2' },
  runReport: { id: 'run-2' },
};

describe('every GET endpoint', () => {
  const { app } = instant();
  const gets = Object.entries(endpoints).filter(
    ([key, endpoint]) => endpoint.method === 'GET' && key !== 'runEventStream',
  );

  it.each(gets)(
    '%s answers with a response that matches the contract',
    async (key, endpoint) => {
      const path = buildPath(endpoint.path, seededParams[key as EndpointKey]);
      const response = await app.request(path, OWNER);

      expect(response.status, path).toBe(200);
      expect(response.headers.get(DATA_SOURCE_HEADER)).toBe('demo');

      const result = endpoint.response.safeParse(await response.json());
      expect(result.success ? [] : result.error.issues, path).toEqual([]);
    },
  );
});

describe('errors', () => {
  const { app } = instant();

  it('describe a missing record', async () => {
    const response = await app.request('/tasks/nope', OWNER);

    expect(response.status).toBe(404);
    expect(ApiError.parse(await response.json()).error.code).toBe('not_found');
  });

  it('reject an invalid query', async () => {
    const response = await app.request('/tasks?limit=lots', OWNER);

    expect(response.status).toBe(400);
    expect(ApiError.parse(await response.json()).error.code).toBe('invalid');
  });

  it('reject an invalid body', async () => {
    const response = await app.request('/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...OWNER.headers },
      body: JSON.stringify({ title: '' }),
    });

    expect(response.status).toBe(400);
  });
});

describe('pagination', () => {
  it('walks the task list with cursors', async () => {
    const { app } = instant();
    const first = endpoints.tasks.response.parse(
      await (await app.request('/tasks?limit=5', OWNER)).json(),
    );
    expect(first.items).toHaveLength(5);
    expect(first.nextCursor).not.toBeNull();

    const second = endpoints.tasks.response.parse(
      await (
        await app.request(`/tasks?limit=5&cursor=${first.nextCursor}`, OWNER)
      ).json(),
    );
    expect(second.items.map(({ id }) => id)).not.toEqual(
      first.items.map(({ id }) => id),
    );
  });

  it('filters tasks by repository and status', async () => {
    const { app } = instant();
    const { items } = endpoints.tasks.response.parse(
      await (
        await app.request('/tasks?repositoryId=repo-2&status=completed', OWNER)
      ).json(),
    );

    expect(items.length).toBeGreaterThan(0);
    expect(
      items.every(
        (task) => task.repositoryId === 'repo-2' && task.status === 'completed',
      ),
    ).toBe(true);
  });
});

describe('the seeded world', () => {
  const { store } = instant();

  it('is identical for the same clock', () => {
    const again = createStore({ speed: Infinity, now: clock });

    expect(JSON.stringify([...again.data.tasks.values()])).toBe(
      JSON.stringify([...store.data.tasks.values()]),
    );
    expect(again.run('org-1', 'run-2')).toEqual(store.run('org-1', 'run-2'));
  });

  it('covers every outcome and status', () => {
    const runs = [...store.data.runs.values()].map(({ run }) => run);
    const outcomes = new Set(runs.map(({ outcome }) => outcome));
    const statuses = new Set(runs.map(({ status }) => status));

    for (const outcome of ['succeeded', 'partial', 'failed', 'unverified']) {
      expect([...outcomes], outcome).toContain(outcome);
    }
    expect([...statuses]).toEqual(
      expect.arrayContaining(['awaiting_approval', 'completed', 'cancelled']),
    );
  });

  it('never claims verified without the checks to show for it', () => {
    for (const { run } of store.data.runs.values()) {
      if (run.verification !== 'verified') continue;
      const required = run.checks.filter((check) => check.required);
      expect(required.length).toBeGreaterThan(0);
      expect(required.every((check) => check.status === 'passed')).toBe(true);
    }
  });
});
