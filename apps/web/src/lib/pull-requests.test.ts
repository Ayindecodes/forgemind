import type { PullRequest } from '@forgemind/contract';
import { describe, expect, it } from 'vitest';

import { filterPullRequests, summarize } from './pull-requests';

const pr = (
  number: number,
  state: PullRequest['state'],
  reviewStatus: PullRequest['reviewStatus'],
  checksStatus: PullRequest['checksStatus'],
  createdAt: string,
): PullRequest => ({
  id: `pr-${number}`,
  taskId: `task-${number}`,
  runId: `run-${number}`,
  repositoryId: 'repo-1',
  number,
  url: `https://github.com/forgemind/api/pull/${number}`,
  title: `Change ${number}`,
  branch: `forgemind/task-${number}`,
  state,
  reviewStatus,
  checksStatus,
  createdAt,
  mergedAt: state === 'merged' ? createdAt : null,
});

const all = [
  pr(1, 'merged', 'approved', 'passed', '2026-11-01T00:00:00Z'),
  pr(2, 'open', 'approved', 'passed', '2026-11-03T00:00:00Z'),
  pr(3, 'open', 'changes_requested', 'failed', '2026-11-02T00:00:00Z'),
  pr(4, 'closed', 'pending', 'pending', '2026-11-04T00:00:00Z'),
];

describe('filterPullRequests', () => {
  it('orders newest first and narrows by state, number, title or branch', () => {
    expect(filterPullRequests(all, {}).map(({ number }) => number)).toEqual([
      4, 2, 3, 1,
    ]);
    expect(
      filterPullRequests(all, { state: 'open' }).map(({ number }) => number),
    ).toEqual([2, 3]);
    expect(
      filterPullRequests(all, { query: '3' }).map(({ number }) => number),
    ).toEqual([3]);
    expect(
      filterPullRequests(all, { query: 'task-1' }).map(({ number }) => number),
    ).toEqual([1]);
  });
});

describe('summarize', () => {
  it('counts what needs eyes', () => {
    expect(summarize(all)).toEqual({
      open: 2,
      merged: 1,
      changesRequested: 1,
      checksFailing: 1,
    });
  });
});
