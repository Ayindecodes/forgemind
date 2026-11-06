import type { Task, TaskCategory } from '@forgemind/contract';

import type { StatusValue } from '@/components/ui/status';

/*
 * Words for the task vocabulary, and the list's filters. "Needs decision"
 * is the view that matters most, so it is first.
 */

export const categoryLabels: Record<TaskCategory, string> = {
  investigate: 'Investigate',
  fix_bug: 'Fix a bug',
  add_tests: 'Add tests',
  security: 'Security',
  dependencies: 'Dependencies',
  refactor: 'Refactor',
  docs: 'Documentation',
  validation: 'Validation',
};

export const categoryHelp: Record<TaskCategory, string> = {
  investigate: 'Explain a failure or a behaviour. Reports; makes no change.',
  fix_bug: 'Reproduce a bug, fix it, and add a regression test.',
  add_tests: 'Cover existing behaviour with tests that prove it.',
  security: 'Investigate a suspected vulnerability and close it.',
  dependencies: 'Upgrade dependencies and make sure nothing breaks.',
  refactor: 'Reduce duplication or untangle a module, behaviour unchanged.',
  docs: 'Write or update documentation from the code as it is.',
  validation: 'Tighten input validation on an endpoint or a form.',
};

export const taskStatusValue: Record<Task['status'], StatusValue> = {
  queued: 'pending',
  running: 'running',
  awaiting_approval: 'awaiting',
  completed: 'passed',
  failed: 'failed',
  cancelled: 'cancelled',
};

export type TaskStatusFilter = 'all' | 'decision' | 'active' | Task['status'];

export const taskStatusFilters: { value: TaskStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'decision', label: 'Needs decision' },
  { value: 'active', label: 'Running or queued' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const matchesStatus = (task: Task, filter: TaskStatusFilter) =>
  filter === 'all'
    ? true
    : filter === 'decision'
      ? task.status === 'awaiting_approval'
      : filter === 'active'
        ? task.status === 'running' || task.status === 'queued'
        : task.status === filter;

export function filterTasks(
  tasks: readonly Task[],
  {
    query = '',
    status = 'all',
    repositoryId = null,
  }: {
    query?: string;
    status?: TaskStatusFilter;
    repositoryId?: string | null;
  },
): Task[] {
  const needle = query.trim().toLowerCase();
  return tasks
    .filter((task) => matchesStatus(task, status))
    .filter(
      (task) => repositoryId === null || task.repositoryId === repositoryId,
    )
    .filter(
      (task) =>
        needle.length === 0 ||
        task.title.toLowerCase().includes(needle) ||
        task.request.toLowerCase().includes(needle),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The dev API's defaults, shown so the limits are never a surprise. */
export const defaultBudget = {
  maxMinutes: 60,
  maxRetries: 2,
  maxTokens: 400_000,
};
