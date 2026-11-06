'use client';

import type { Repository } from '@forgemind/contract';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, defineColumns } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectItem } from '@/components/ui/select';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Status, type StatusValue } from '@/components/ui/status';
import { request } from '@/lib/api-client';
import { formatRelative } from '@/lib/format';
import { keys, useRepositories, useSession } from '@/lib/queries';
import {
  brokenConnections,
  filterRepositories,
  statusFilters,
  type StatusFilter,
} from '@/lib/repositories';
import { toast } from '@/lib/toast';

import { ConnectDialog } from './connect-dialog';
import { InstallationPanel } from './installation-panel';

/*
 * Every repository ForgeMind can see, what state its connection is in, and
 * the way to connect more or let one go. A broken connection is the first
 * thing on the page, with the reason the API gave.
 */

const MANAGERS = ['owner', 'admin', 'developer'];

const statusOf: Record<Repository['status'], StatusValue> = {
  connected: 'passed',
  analyzing: 'running',
  error: 'failed',
  revoked: 'cancelled',
};
const statusLabel: Record<Repository['status'], string> = {
  connected: 'Indexed',
  analyzing: 'Indexing',
  error: 'Needs attention',
  revoked: 'Revoked',
};

type Row = Repository & {
  onDisconnect: () => void;
  onReconnect: () => void;
  canManage: boolean;
};

const columns = defineColumns<Row>();
const repositoryColumns = columns.columns([
  columns.accessor('fullName', {
    header: 'Repository',
    size: 240,
    meta: { grow: 3 },
    cell: ({ row, getValue }) => (
      <span className="flex min-w-0 items-center gap-2">
        <Link
          href={`/repositories/${row.original.id}`}
          className="touch-target truncate font-mono text-code hover:underline"
          data-testid={`repository-${row.original.id}`}
        >
          {getValue()}
        </Link>
        {row.original.private && <Badge>private</Badge>}
      </span>
    ),
  }),
  columns.accessor('status', {
    header: 'Connection',
    size: 150,
    cell: ({ getValue }) => (
      <Status
        status={statusOf[getValue()]}
        size="sm"
        label={statusLabel[getValue()]}
      />
    ),
  }),
  columns.accessor('languages', {
    header: 'Languages',
    size: 160,
    enableSorting: false,
    cell: ({ getValue }) => (
      <span className="truncate text-fg-secondary">
        {getValue()
          .slice(0, 3)
          .map(({ name }) => name)
          .join(', ')}
      </span>
    ),
  }),
  columns.accessor('openFindings', {
    header: 'Findings',
    size: 90,
    meta: { align: 'right' },
    cell: ({ getValue }) =>
      getValue() > 0 ? (
        <span className="text-warning-fg">{getValue()}</span>
      ) : (
        <span className="text-fg-muted">0</span>
      ),
  }),
  columns.accessor('lastAnalyzedAt', {
    header: 'Indexed',
    size: 130,
    cell: ({ getValue }) => {
      const value = getValue();
      return value ? (
        <span className="text-fg-secondary">{formatRelative(value)}</span>
      ) : (
        <span className="text-fg-muted">never</span>
      );
    },
  }),
  columns.display({
    id: 'actions',
    header: () => <span className="sr-only">Actions</span>,
    size: 120,
    meta: { align: 'right' },
    cell: ({ row }) =>
      row.original.canManage ? (
        row.original.status === 'revoked' ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={row.original.onReconnect}
            data-testid={`reconnect-${row.original.id}`}
          >
            Reconnect
          </Button>
        ) : (
          <ConfirmDialog
            trigger={
              <Button
                size="sm"
                variant="ghost"
                data-testid={`disconnect-${row.original.id}`}
              >
                Disconnect
              </Button>
            }
            destructive
            title={`Disconnect ${row.original.fullName}?`}
            description="ForgeMind stops reading it and its analysis is dropped. Tasks and reports stay. You can reconnect later."
            confirmLabel="Disconnect"
            onConfirm={row.original.onDisconnect}
          />
        )
      ) : null,
  }),
]);

export function RepositoriesPage() {
  const session = useSession();
  const client = useQueryClient();
  const repositories = useRepositories(true, { liveWhileAnalyzing: true });
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [connecting, setConnecting] = useState(false);
  const canManage = MANAGERS.includes(session.data?.role ?? '');

  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: keys.repositories }),
      client.invalidateQueries({ queryKey: ['github-repositories'] }),
    ]);
  const disconnect = useMutation({
    mutationFn: (id: string) =>
      request('disconnectRepository', { params: { id } }),
    onSuccess: async () => {
      toast({ title: 'Repository disconnected', tone: 'info' });
      await refresh();
    },
    onError: (error) =>
      toast({
        title: 'Could not disconnect',
        description: error.message,
        tone: 'error',
      }),
  });
  const reconnect = useMutation({
    mutationFn: (repo: Repository) =>
      request('connectRepository', {
        body: { githubId: repo.githubId, fullName: repo.fullName },
      }),
    onSuccess: async () => {
      toast({ title: 'Reconnected. Indexing has started.', tone: 'success' });
      await refresh();
    },
    onError: (error) =>
      toast({
        title: 'Could not reconnect',
        description: error.message,
        tone: 'error',
      }),
  });

  const all = useMemo(
    () => repositories.data?.items ?? [],
    [repositories.data],
  );
  const rows: Row[] = useMemo(
    () =>
      filterRepositories(all, { query, status }).map((repo) => ({
        ...repo,
        canManage,
        onDisconnect: () =>
          disconnect.mutateAsync(repo.id).then(() => undefined),
        onReconnect: () => reconnect.mutate(repo),
      })),
    // The mutations are stable; the rows only change with their inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, query, status, canManage],
  );
  const broken = brokenConnections(all);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Repositories"
        description="Connected GitHub repositories and the state of each connection."
        actions={
          canManage && (
            <Button
              variant="primary"
              icon={<Plus />}
              onClick={() => setConnecting(true)}
              data-testid="connect-repository"
            >
              Connect repository
            </Button>
          )
        }
      />

      {broken.length > 0 && (
        <section
          role="alert"
          aria-label="Broken connections"
          data-testid="broken-connections"
          className="rounded-lg border border-error-fg/40 bg-error-subtle px-4 py-3 text-sm"
        >
          <p className="font-medium text-error-fg">
            {broken.length === 1
              ? '1 connection is broken.'
              : `${broken.length} connections are broken.`}
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {broken.map((repo) => (
              <li
                key={repo.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1"
              >
                <span className="font-mono">{repo.fullName}</span>
                <span className="text-fg-secondary">{repo.statusMessage}</span>
                <Button
                  asChild
                  size="sm"
                  variant="secondary"
                  icon={<ExternalLink />}
                >
                  <a href={repo.url} target="_blank" rel="noreferrer">
                    Open on GitHub
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <InstallationPanel canInstall={canManage} />

      <div className="material-solid">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <Input
            type="search"
            icon={<Search />}
            placeholder="Search by name or language"
            aria-label="Search repositories"
            data-testid="repository-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-64"
          />
          <div className="w-44">
            <Select
              aria-label="Connection state"
              value={status}
              onValueChange={(value) => setStatus(value as StatusFilter)}
              data-testid="repository-filter"
            >
              {statusFilters.map((filter) => (
                <SelectItem key={filter.value} value={filter.value}>
                  {filter.label}
                </SelectItem>
              ))}
            </Select>
          </div>
          <span
            className="ml-auto text-sm text-fg-secondary tabular-nums"
            data-testid="repository-count"
          >
            {rows.length} of {all.length}
          </span>
        </div>
        {repositories.error ? (
          <ErrorState
            title="Could not load repositories"
            onRetry={async () => {
              await repositories.refetch();
            }}
          />
        ) : (
          <DataTable
            columns={repositoryColumns}
            data={rows}
            caption="Repositories"
            getRowId={(row) => row.id}
            loading={repositories.isPending}
            height={Math.max(160, Math.min(600, 48 + rows.length * 40))}
            rowHeight={40}
            emptyState={
              all.length === 0 ? (
                <EmptyState
                  title="No repositories connected"
                  description="Connect one and ForgeMind indexes it."
                  action={
                    canManage && (
                      <Button
                        variant="primary"
                        onClick={() => setConnecting(true)}
                      >
                        Connect repository
                      </Button>
                    )
                  }
                />
              ) : (
                <EmptyState
                  title="Nothing matches"
                  description="Try another name, or widen the connection filter."
                />
              )
            }
          />
        )}
      </div>

      <ConnectDialog open={connecting} onOpenChange={setConnecting} />
    </div>
  );
}
