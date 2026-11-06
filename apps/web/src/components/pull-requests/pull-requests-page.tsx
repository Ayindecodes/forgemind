'use client';

import type { PullRequest } from '@forgemind/contract';
import { ExternalLink, Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, defineColumns } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Select, SelectItem } from '@/components/ui/select';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Status } from '@/components/ui/status';
import { formatRelative } from '@/lib/format';
import {
  checksLabels,
  checksStatus,
  filterPullRequests,
  reviewLabels,
  reviewStatus,
  stateFilters,
  summarize,
  type StateFilter,
} from '@/lib/pull-requests';
import { usePullRequests, useRepositories } from '@/lib/queries';

type Row = PullRequest & { repositoryName: string };

const columns = defineColumns<Row>();
const prColumns = columns.columns([
  columns.accessor('number', {
    header: 'Pull request',
    size: 300,
    meta: { grow: 3 },
    cell: ({ row, getValue }) => (
      <span className="flex min-w-0 items-center gap-2">
        <a
          href={row.original.url}
          target="_blank"
          rel="noreferrer"
          className="truncate hover:underline"
          data-testid={`pr-${row.original.id}`}
        >
          <span className="font-mono text-fg-secondary">#{getValue()}</span>{' '}
          <span className="font-medium">{row.original.title}</span>
        </a>
        <ExternalLink
          aria-hidden="true"
          className="size-3.5 shrink-0 text-fg-muted"
        />
      </span>
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
  columns.accessor('state', {
    header: 'State',
    size: 100,
    cell: ({ getValue }) => (
      <Badge
        tone={
          getValue() === 'merged'
            ? 'accent'
            : getValue() === 'open'
              ? 'success'
              : 'neutral'
        }
      >
        {getValue()}
      </Badge>
    ),
  }),
  columns.accessor('reviewStatus', {
    header: 'Review',
    size: 170,
    cell: ({ getValue }) => (
      <Status
        status={reviewStatus[getValue()]}
        size="sm"
        label={reviewLabels[getValue()]}
      />
    ),
  }),
  columns.accessor('checksStatus', {
    header: 'Checks',
    size: 150,
    cell: ({ getValue }) => (
      <Status
        status={checksStatus[getValue()]}
        size="sm"
        label={checksLabels[getValue()]}
      />
    ),
  }),
  columns.accessor('taskId', {
    header: 'Task',
    size: 110,
    enableSorting: false,
    cell: ({ getValue }) => (
      <Link
        href={`/tasks/${getValue()}`}
        className="font-mono text-xs hover:underline"
        data-testid={`pr-task-${getValue()}`}
      >
        {getValue()}
      </Link>
    ),
  }),
  columns.accessor('createdAt', {
    header: 'Opened',
    size: 120,
    meta: { align: 'right' },
    cell: ({ getValue }) => (
      <span className="text-fg-secondary">{formatRelative(getValue())}</span>
    ),
  }),
]);

export function PullRequestsPage() {
  const pullRequests = usePullRequests();
  const repositories = useRepositories();
  const [query, setQuery] = useState('');
  const [state, setState] = useState<StateFilter>('all');

  const all = useMemo(
    () => pullRequests.data?.items ?? [],
    [pullRequests.data],
  );
  const rows: Row[] = useMemo(() => {
    const names = new Map(
      (repositories.data?.items ?? []).map((repo) => [repo.id, repo.fullName]),
    );
    return filterPullRequests(all, { query, state }).map((pr) => ({
      ...pr,
      repositoryName: names.get(pr.repositoryId) ?? pr.repositoryId,
    }));
  }, [all, query, state, repositories.data]);
  const summary = summarize(all);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Pull Requests"
        description="Changes delivered for review, and their status on GitHub. ForgeMind opens pull requests; people merge them on GitHub. Nothing here merges."
      />

      <section
        aria-label="Pull request summary"
        data-testid="pr-summary"
        className="material-solid flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm tabular-nums"
      >
        <span>
          <span className="font-semibold" data-summary="open">
            {summary.open}
          </span>{' '}
          open
        </span>
        <span>
          <span className="font-semibold" data-summary="merged">
            {summary.merged}
          </span>{' '}
          merged
        </span>
        <span className={summary.changesRequested > 0 ? 'text-warning-fg' : ''}>
          <span className="font-semibold" data-summary="changes">
            {summary.changesRequested}
          </span>{' '}
          with changes requested
        </span>
        <span className={summary.checksFailing > 0 ? 'text-error-fg' : ''}>
          <span className="font-semibold" data-summary="failing">
            {summary.checksFailing}
          </span>{' '}
          with failing checks
        </span>
      </section>

      <div className="material-solid">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <Input
            type="search"
            icon={<Search />}
            placeholder="Search by title, branch or number"
            aria-label="Search pull requests"
            data-testid="pr-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-64"
          />
          <div className="w-36">
            <Select
              aria-label="State"
              value={state}
              onValueChange={(value) => setState(value as StateFilter)}
              data-testid="pr-state-filter"
            >
              {stateFilters.map((filter) => (
                <SelectItem key={filter.value} value={filter.value}>
                  {filter.label}
                </SelectItem>
              ))}
            </Select>
          </div>
          <span
            className="ml-auto text-sm text-fg-secondary tabular-nums"
            data-testid="pr-count"
          >
            {rows.length} of {all.length}
          </span>
        </div>
        {pullRequests.error ? (
          <ErrorState
            title="Could not load pull requests"
            onRetry={async () => {
              await pullRequests.refetch();
            }}
          />
        ) : (
          <DataTable
            columns={prColumns}
            data={rows}
            caption="Pull requests"
            getRowId={(row) => row.id}
            loading={pullRequests.isPending}
            height={Math.max(160, Math.min(640, 48 + rows.length * 40))}
            rowHeight={40}
            emptyState={
              all.length === 0 ? (
                <EmptyState
                  title="No pull requests yet"
                  description="A pull request is opened after you approve a verified run."
                  action={
                    <Button asChild variant="secondary">
                      <Link href="/tasks">Tasks awaiting approval</Link>
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  title="Nothing matches"
                  description="Try other words or another state."
                />
              )
            }
          />
        )}
      </div>
    </div>
  );
}
