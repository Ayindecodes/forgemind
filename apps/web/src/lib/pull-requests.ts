import type { PullRequest } from '@forgemind/contract';

import type { StatusValue } from '@/components/ui/status';

/*
 * Pull requests as GitHub reports them. ForgeMind opens them; people merge
 * them on GitHub. Nothing in this app merges, so nothing here offers to.
 */

export type StateFilter = 'all' | PullRequest['state'];

export const stateFilters: { value: StateFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'merged', label: 'Merged' },
  { value: 'closed', label: 'Closed' },
];

export const reviewLabels: Record<PullRequest['reviewStatus'], string> = {
  pending: 'Review pending',
  approved: 'Approved',
  changes_requested: 'Changes requested',
};

export const reviewStatus: Record<PullRequest['reviewStatus'], StatusValue> = {
  pending: 'pending',
  approved: 'passed',
  changes_requested: 'failed',
};

export const checksLabels: Record<PullRequest['checksStatus'], string> = {
  pending: 'Checks pending',
  passed: 'Checks passed',
  failed: 'Checks failed',
};

export const checksStatus: Record<PullRequest['checksStatus'], StatusValue> = {
  pending: 'pending',
  passed: 'passed',
  failed: 'failed',
};

export function filterPullRequests(
  pullRequests: readonly PullRequest[],
  { query = '', state = 'all' }: { query?: string; state?: StateFilter },
): PullRequest[] {
  const needle = query.trim().toLowerCase();
  return pullRequests
    .filter((pr) => state === 'all' || pr.state === state)
    .filter(
      (pr) =>
        needle.length === 0 ||
        pr.title.toLowerCase().includes(needle) ||
        pr.branch.toLowerCase().includes(needle) ||
        String(pr.number).includes(needle),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function summarize(pullRequests: readonly PullRequest[]) {
  return {
    open: pullRequests.filter((pr) => pr.state === 'open').length,
    merged: pullRequests.filter((pr) => pr.state === 'merged').length,
    changesRequested: pullRequests.filter(
      (pr) => pr.state === 'open' && pr.reviewStatus === 'changes_requested',
    ).length,
    checksFailing: pullRequests.filter(
      (pr) => pr.state === 'open' && pr.checksStatus === 'failed',
    ).length,
  };
}
