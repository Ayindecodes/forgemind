'use client';

import type { Task } from '@forgemind/contract';
import { Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { DataTable, defineColumns } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Select, SelectItem } from '@/components/ui/select';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Status } from '@/components/ui/status';
import { formatRelative } from '@/lib/format';
import { useRepositories, useTasks } from '@/lib/queries';
import {
  categoryLabels,
  filterTasks,
  taskStatusFilters,
  taskStatusValue,
  type TaskStatusFilter,
} from '@/lib/tasks';

/* Everything ForgeMind has been asked to do, newest first, narrowed as needed. */

type Row = Task & { repositoryName: string };

const columns = defineColumns<Row>();
const taskColumns = columns.columns([
  columns.accessor('title', {
    header: 'Task',
    size: 280,
    meta: { grow: 3 },
    cell: ({ row, getValue }) => (
      <Link
        href={`/tasks/${row.original.id}`}
        className="touch-target truncate font-medium hover:underline"
        data-testid={`task-${row.original.id}`}
      >
        {getValue()}
      </Link>
    ),
  }),
  columns.accessor('repositoryName', {
    header: 'Repository',
    size: 160,
    cell: ({ getValue }) => (
      <span className="truncate font-mono text-code text-fg-secondary">
        {getValue()}
      </span>
    ),
  }),
  columns.accessor('category', {
    header: 'Type',
    size: 130,
    cell: ({ getValue }) => (
      <span className="text-fg-secondary">{categoryLabels[getValue()]}</span>
    ),
  }),
  columns.accessor('status', {
    header: 'Status',
    size: 170,
    cell: ({ getValue }) => (
      <Status status={taskStatusValue[getValue()]} size="sm" />
    ),
  }),
  columns.accessor('updatedAt', {
    header: 'Updated',
    size: 130,
    meta: { align: 'right' },
    cell: ({ getValue }) => (
      <span className="text-fg-secondary">{formatRelative(getValue())}</span>
    ),
  }),
]);

export function TasksPage() {
  const tasks = useTasks(true, { live: true });
  const repositories = useRepositories();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<TaskStatusFilter>('all');
  const [repositoryId, setRepositoryId] = useState<string>('all');

  const all = useMemo(() => tasks.data?.items ?? [], [tasks.data]);
  const rows: Row[] = useMemo(() => {
    const names = new Map(
      (repositories.data?.items ?? []).map((repo) => [repo.id, repo.fullName]),
    );
    return filterTasks(all, {
      query,
      status,
      repositoryId: repositoryId === 'all' ? null : repositoryId,
    }).map((task) => ({
      ...task,
      repositoryName: names.get(task.repositoryId) ?? task.repositoryId,
    }));
  }, [all, query, status, repositoryId, repositories.data]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Engineering Tasks"
        description="Everything ForgeMind has been asked to do, and how it went."
        actions={
          <Button asChild variant="primary" icon={<Plus />}>
            <Link href="/tasks/new" data-testid="new-task">
              New task
            </Link>
          </Button>
        }
      />
      <div className="material-solid">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <Input
            type="search"
            icon={<Search />}
            placeholder="Search tasks"
            aria-label="Search tasks"
            data-testid="task-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-64"
          />
          <div className="w-48">
            <Select
              aria-label="Status"
              value={status}
              onValueChange={(value) => setStatus(value as TaskStatusFilter)}
              data-testid="task-status-filter"
            >
              {taskStatusFilters.map((filter) => (
                <SelectItem key={filter.value} value={filter.value}>
                  {filter.label}
                </SelectItem>
              ))}
            </Select>
          </div>
          <div className="w-52">
            <Select
              aria-label="Repository"
              value={repositoryId}
              onValueChange={setRepositoryId}
              data-testid="task-repository-filter"
            >
              <SelectItem value="all">All repositories</SelectItem>
              {(repositories.data?.items ?? []).map((repo) => (
                <SelectItem key={repo.id} value={repo.id}>
                  {repo.fullName}
                </SelectItem>
              ))}
            </Select>
          </div>
          <span
            className="ml-auto text-sm text-fg-secondary tabular-nums"
            data-testid="task-count"
          >
            {rows.length} of {all.length}
          </span>
        </div>
        {tasks.error ? (
          <ErrorState
            title="Could not load tasks"
            onRetry={async () => {
              await tasks.refetch();
            }}
          />
        ) : (
          <DataTable
            columns={taskColumns}
            data={rows}
            caption="Engineering tasks"
            getRowId={(row) => row.id}
            loading={tasks.isPending}
            height={Math.max(160, Math.min(640, 48 + rows.length * 40))}
            rowHeight={40}
            emptyState={
              all.length === 0 ? (
                <EmptyState
                  title="No tasks yet"
                  description="Describe what should change, and ForgeMind takes it from there."
                  action={
                    <Button asChild variant="primary">
                      <Link href="/tasks/new">New task</Link>
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  title="Nothing matches"
                  description="Try other words, or widen the filters."
                />
              )
            }
          />
        )}
      </div>
    </div>
  );
}
