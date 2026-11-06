import { TaskCategory, type Task } from '@forgemind/contract';
import { describe, expect, it } from 'vitest';

import { categoryHelp, categoryLabels, filterTasks } from './tasks';

const task = (
  id: string,
  status: Task['status'],
  repositoryId: string,
  updatedAt: string,
  title = id,
): Task => ({
  id,
  organizationId: 'org-1',
  repositoryId,
  title,
  request: `Please ${title}`,
  category: 'fix_bug',
  baseCommit: 'abc',
  branch: null,
  status,
  decision: null,
  runId: `run-${id}`,
  budget: { maxMinutes: 60, maxRetries: 2, maxTokens: 1000 },
  createdBy: 'user-1',
  createdAt: updatedAt,
  updatedAt,
});

const all = [
  task(
    'a',
    'awaiting_approval',
    'repo-1',
    '2026-11-06T10:00:00Z',
    'Fix retry budget',
  ),
  task('b', 'running', 'repo-2', '2026-11-06T12:00:00Z', 'Add webhook tests'),
  task('c', 'completed', 'repo-1', '2026-11-06T11:00:00Z', 'Document release'),
  task('d', 'queued', 'repo-1', '2026-11-06T09:00:00Z', 'Upgrade lodash'),
];

describe('filterTasks', () => {
  it('sorts newest first and narrows by status, repository and words', () => {
    expect(filterTasks(all, {}).map(({ id }) => id)).toEqual([
      'b',
      'c',
      'a',
      'd',
    ]);
    expect(
      filterTasks(all, { status: 'decision' }).map(({ id }) => id),
    ).toEqual(['a']);
    expect(filterTasks(all, { status: 'active' }).map(({ id }) => id)).toEqual([
      'b',
      'd',
    ]);
    expect(
      filterTasks(all, { repositoryId: 'repo-1' }).map(({ id }) => id),
    ).toEqual(['c', 'a', 'd']);
    expect(
      filterTasks(all, { query: 'please upgrade' }).map(({ id }) => id),
    ).toEqual(['d']);
    expect(filterTasks(all, { query: 'WEBHOOK' }).map(({ id }) => id)).toEqual([
      'b',
    ]);
  });
});

describe('category words', () => {
  it('has a label and a line of help for every category', () => {
    for (const category of TaskCategory.options) {
      expect(categoryLabels[category].length).toBeGreaterThan(0);
      expect(categoryHelp[category]).toMatch(/\.$/);
    }
  });
});
