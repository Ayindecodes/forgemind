'use client';

import type { Run } from '@forgemind/contract';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import {
  runStatus,
  verificationLabel,
  verificationStatus,
} from '@/components/run/run-status';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { DataTable, defineColumns } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Select, SelectItem } from '@/components/ui/select';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Status } from '@/components/ui/status';
import { formatDuration, formatRelative } from '@/lib/format';
import { useRepositories, useRuns, useTasks } from '@/lib/queries';

/*
 * Every run the organisation has made, newest first. Each one reopens as
 * the live workspace replaying its recorded events, however old it is.
 */

type Row = Run & { taskTitle: string; repositoryName: string; latest: boolean };

const outcomes = ['succeeded', 'partial', 'failed', 'unverified'] as const;

const columns = defineColumns<Row>();
const runColumns = columns.columns([
  columns.accessor('taskTitle', {
    header: 'Task',
    size: 280,
    meta: { grow: 3 },
    cell: ({ row, getValue }) => (
      <Link
        href={`/tasks/${row.original.taskId}${row.original.latest ? '' : `?run=${row.original.id}`}`}
        className="touch-target truncate font-medium hover:underline"
        data-testid={`run-${row.original.id}`}
        data-latest={row.original.latest}
      >
        {getValue()}
      </Link>
    ),
  }),
  columns.accessor('repositoryName', {
    header: 'Repository',
    size: 150,
    cell: ({ getValue }) => (
      <span className="truncate font-mono text-code text-fg-secondary">
        {getValue()}
      </span>
    ),
  }),
  columns.accessor('status', {
    header: 'Result',
    size: 150,
    cell: ({ row }) => <Status status={runStatus(row.original)} size="sm" />,
  }),
  columns.accessor('verification', {
    header: 'Verification',
    size: 150,
    cell: ({ getValue }) => (
      <Status
        status={verificationStatus[getValue()]}
        size="sm"
        label={verificationLabel[getValue()]}
      />
    ),
  }),
  columns.accessor('retries', {
    header: 'Attempts',
    size: 90,
    meta: { align: 'right' },
    enableSorting: false,
    cell: ({ getValue }) => (
      <span className="tabular-nums">{getValue().used + 1}</span>
    ),
  }),
  columns.accessor('startedAt', {
    header: 'Started',
    size: 130,
    meta: { align: 'right' },
    cell: ({ getValue }) => {
      const value = getValue();
      return (
        <span className="text-fg-secondary">
          {value ? formatRelative(value) : 'not yet'}
        </span>
      );
    },
  }),
  columns.accessor('finishedAt', {
    header: 'Took',
    size: 90,
    meta: { align: 'right' },
    enableSorting: false,
    cell: ({ row }) => {
      const { startedAt, finishedAt } = row.original;
      return (
        <span className="text-fg-secondary tabular-nums">
          {startedAt && finishedAt
            ? formatDuration(Date.parse(finishedAt) - Date.parse(startedAt))
            : startedAt
              ? 'ongoing'
              : ''}
        </span>
      );
    },
  }),
]);

export function HistoryPage() {
  const [outcome, setOutcome] = useState('all');
  const [repositoryId, setRepositoryId] = useState('all');
  const [query, setQuery] = useState('');
  const runs = useRuns({
    ...(outcome === 'all' ? {} : { outcome }),
    ...(repositoryId === 'all' ? {} : { repositoryId }),
  });
  const tasks = useTasks();
  const repositories = useRepositories();

  const rows: Row[] = useMemo(() => {
    const titles = new Map(
      (tasks.data?.items ?? []).map((task) => [task.id, task]),
    );
    const names = new Map(
      (repositories.data?.items ?? []).map((repo) => [repo.id, repo.fullName]),
    );
    const needle = query.trim().toLowerCase();
    return (runs.data?.items ?? [])
      .map((run) => {
        const task = titles.get(run.taskId);
        return {
          ...run,
          taskTitle: task?.title ?? run.taskId,
          repositoryName: names.get(task?.repositoryId ?? '') ?? '',
          latest: task?.runId === run.id,
        };
      })
      .filter(
        (row) =>
          needle.length === 0 ||
          row.taskTitle.toLowerCase().includes(needle) ||
          row.id.toLowerCase().includes(needle),
      );
  }, [runs.data, tasks.data, repositories.data, query]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Execution History"
        description="Every run, replayable from its recorded events. Older runs of a task stay on the record."
      />
      <div className="material-solid">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <Input
            type="search"
            icon={<Search />}
            placeholder="Search by task or run id"
            aria-label="Search runs"
            data-testid="run-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-64"
          />
          <div className="w-40">
            <Select
              aria-label="Outcome"
              value={outcome}
              onValueChange={setOutcome}
              data-testid="run-outcome-filter"
            >
              <SelectItem value="all">All outcomes</SelectItem>
              {outcomes.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </Select>
          </div>
          <div className="w-52">
            <Select
              aria-label="Repository"
              value={repositoryId}
              onValueChange={setRepositoryId}
              data-testid="run-repository-filter"
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
            data-testid="run-count"
          >
            {rows.length} {rows.length === 1 ? 'run' : 'runs'}
          </span>
        </div>
        {runs.error ? (
          <ErrorState
            title="Could not load the history"
            onRetry={async () => {
              await runs.refetch();
            }}
          />
        ) : (
          <DataTable
            columns={runColumns}
            data={rows}
            caption="Runs"
            getRowId={(row) => row.id}
            loading={runs.isPending || tasks.isPending}
            height={Math.max(160, Math.min(640, 48 + rows.length * 40))}
            rowHeight={40}
            emptyState={
              <EmptyState
                title="No runs match"
                description="Widen the filters, or start a task."
                action={
                  <Button asChild variant="secondary">
                    <Link href="/tasks/new">New task</Link>
                  </Button>
                }
              />
            }
          />
        )}
      </div>
    </div>
  );
}
