import { describe, expect, it } from 'vitest';

import { createStore } from './store';

const clock = () => new Date('2026-11-06T12:00:00Z');

describe('the run list', () => {
  const store = createStore({ speed: Infinity, now: clock });

  it('lists every run of the organisation, newest first', () => {
    const runs = store.runs('org-1');
    expect(runs.length).toBeGreaterThan(12);
    const started = runs.map(({ startedAt }) => startedAt ?? '');
    expect(started).toEqual([...started].sort().reverse());
  });

  it('keeps an earlier run of a task on the record', () => {
    const runs = store.runs('org-1', { taskId: 'task-7' });
    expect(runs.map(({ outcome }) => outcome)).toEqual(['succeeded', 'failed']);
    expect(store.task('org-1', 'task-7').runId).toBe(runs[0]?.id);
  });

  it('narrows by outcome, status and repository', () => {
    expect(
      store
        .runs('org-1', { outcome: 'failed' })
        .every(({ outcome }) => outcome === 'failed'),
    ).toBe(true);
    expect(
      store
        .runs('org-1', { status: 'awaiting_approval' })
        .every(({ status }) => status === 'awaiting_approval'),
    ).toBe(true);
    const onApi = store.runs('org-1', { repositoryId: 'repo-1' });
    expect(onApi.length).toBeGreaterThan(0);
    expect(
      onApi.every(
        ({ taskId }) => store.task('org-1', taskId).repositoryId === 'repo-1',
      ),
    ).toBe(true);
  });

  it('shows another organisation nothing', () => {
    expect(store.runs('org-2')).toEqual([]);
  });
});

describe('seeded history keeps its own times', () => {
  const store = createStore({ speed: Infinity, now: clock });

  it('stamps a task with the event that moved it, not the server start', () => {
    const task = store
      .tasks('org-1')
      .find(
        (item) => item.id === 'task-2' && item.status === 'awaiting_approval',
      );
    expect(task).toBeTruthy();
    const events = store.eventsAfter('org-1', task!.runId, 0);
    const last = events.at(-1)!.at;
    expect(task!.updatedAt).toBe(last);
    expect(new Date(last).getTime()).toBeLessThan(clock().getTime());
  });

  it('dates the review notification to that moment too', () => {
    const task = store.tasks('org-1').find((item) => item.id === 'task-2')!;
    const note = store
      .notifications('org-1')
      .find((item) => item.href === `/tasks/${task.id}`);
    expect(note).toBeTruthy();
    expect(note!.createdAt).toBe(task.updatedAt);
  });
});
