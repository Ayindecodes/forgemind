'use client';

import type { AuditEvent, Repository, Task } from '@forgemind/contract';
import { ArrowRight, Plus } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { Metric, MetricGroup } from '@/components/ui/metric';
import { SkeletonText } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Status, type StatusValue } from '@/components/ui/status';
import {
  formatCompact,
  formatCurrency,
  formatDuration,
  formatRelative,
} from '@/lib/format';
import { activeWork, describeAction } from '@/lib/overview';
import {
  useAudit,
  useOrganization,
  useRepositories,
  useTasks,
  useUsage,
} from '@/lib/queries';

/*
 * The command centre. Work that needs a person leads, then what is running,
 * then the repositories, what people did, and what it all cost. Every
 * number on the page is a field of the contract, shown as it came.
 */

const taskStatus: Record<Task['status'], StatusValue> = {
  queued: 'pending',
  running: 'running',
  awaiting_approval: 'awaiting',
  completed: 'passed',
  failed: 'failed',
  cancelled: 'cancelled',
};

const repositoryStatus: Record<Repository['status'], StatusValue> = {
  analyzing: 'running',
  connected: 'passed',
  error: 'failed',
  revoked: 'cancelled',
};

const targetHref = (target: AuditEvent['target']) =>
  target.type === 'repository'
    ? `/repositories/${target.id}`
    : target.type === 'task'
      ? `/tasks/${target.id}`
      : null;

export function Overview() {
  const organization = useOrganization();
  const tasks = useTasks(true, { live: true });
  const repositories = useRepositories();
  const usage = useUsage();
  const audit = useAudit(8);

  const repoName = (id: string) =>
    repositories.data?.items.find((repo) => repo.id === id)?.fullName ?? id;
  const active = activeWork(tasks.data?.items ?? []);
  const connected = (repositories.data?.items ?? []).filter(
    ({ status }) => status !== 'revoked',
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Overview"
        description={
          organization.data
            ? `${organization.data.name}: what needs you, what is running, and what it costs.`
            : 'What needs you, what is running, and what it costs.'
        }
        actions={
          <Button asChild variant="primary" icon={<Plus />}>
            <Link href="/tasks/new" data-testid="new-task">
              New task
            </Link>
          </Button>
        }
      />

      <Panel
        id="active"
        title="Active work"
        testId="active-work"
        aside={
          <Button asChild size="sm" variant="ghost" icon={<ArrowRight />}>
            <Link href="/tasks">All tasks</Link>
          </Button>
        }
      >
        {tasks.isPending ? (
          <Loading />
        ) : tasks.error ? (
          <Failed
            what="tasks"
            onRetry={async () => {
              await tasks.refetch();
            }}
          />
        ) : active.length === 0 ? (
          <EmptyState
            title="Nothing is running"
            description="Start a task and ForgeMind will investigate, change, verify and report."
            action={
              <Button asChild variant="primary">
                <Link href="/tasks/new">New task</Link>
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-line" data-testid="active-list">
            {active.map((task) => (
              <li key={task.id}>
                <Link
                  href={`/tasks/${task.id}`}
                  data-testid={`active-${task.id}`}
                  data-status={task.status}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm hover:bg-hover"
                >
                  <Status status={taskStatus[task.status]} size="sm" iconOnly />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {task.title}
                  </span>
                  <span className="font-mono text-xs text-fg-secondary">
                    {repoName(task.repositoryId)}
                  </span>
                  <Status status={taskStatus[task.status]} size="sm" />
                  <span className="text-xs text-fg-muted">
                    {formatRelative(task.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel
          id="repositories"
          title="Repositories"
          testId="repositories"
          aside={
            <Button asChild size="sm" variant="ghost" icon={<ArrowRight />}>
              <Link href="/repositories">All repositories</Link>
            </Button>
          }
        >
          {repositories.isPending ? (
            <Loading />
          ) : repositories.error ? (
            <Failed
              what="repositories"
              onRetry={async () => {
                await repositories.refetch();
              }}
            />
          ) : connected.length === 0 ? (
            <EmptyState
              title="No repositories connected"
              description="Connect a GitHub repository and ForgeMind indexes it."
              action={
                <Button asChild variant="secondary">
                  <Link href="/repositories">Connect a repository</Link>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-line" data-testid="repository-list">
              {connected.slice(0, 6).map((repo) => (
                <li key={repo.id}>
                  <Link
                    href={`/repositories/${repo.id}`}
                    data-testid={`repository-${repo.id}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm hover:bg-hover"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono">
                      {repo.fullName}
                    </span>
                    <span className="text-xs text-fg-secondary">
                      {repo.languages
                        .slice(0, 2)
                        .map(({ name }) => name)
                        .join(', ')}
                    </span>
                    {repo.openFindings > 0 && (
                      <span className="text-xs text-warning-fg">
                        {repo.openFindings} open{' '}
                        {repo.openFindings === 1 ? 'finding' : 'findings'}
                      </span>
                    )}
                    <Status
                      status={repositoryStatus[repo.status]}
                      size="sm"
                      label={
                        repo.status === 'connected' && repo.lastAnalyzedAt
                          ? `Indexed ${formatRelative(repo.lastAnalyzedAt)}`
                          : undefined
                      }
                    />
                    {repo.status !== 'connected' && repo.statusMessage && (
                      <span className="basis-full text-xs text-fg-secondary">
                        {repo.statusMessage}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel id="activity" title="Activity" testId="activity">
          {audit.isPending ? (
            <Loading />
          ) : audit.error ? (
            <Failed
              what="activity"
              onRetry={async () => {
                await audit.refetch();
              }}
            />
          ) : audit.data.items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-fg-secondary">
              Nothing has happened yet.
            </p>
          ) : (
            <ol className="divide-y divide-line" data-testid="activity-list">
              {audit.data.items.map((event) => {
                const href = targetHref(event.target);
                return (
                  <li
                    key={event.id}
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 py-2.5 text-sm"
                  >
                    <span className="font-medium">{event.actorName}</span>
                    <span className="text-fg-secondary">
                      {describeAction(event)}
                    </span>
                    {href ? (
                      <Link
                        href={href}
                        className="font-mono text-xs underline-offset-2 hover:underline"
                      >
                        {event.target.label}
                      </Link>
                    ) : (
                      <span className="font-mono text-xs">
                        {event.target.label}
                      </span>
                    )}
                    <time
                      dateTime={event.at}
                      className="ml-auto text-xs text-fg-muted"
                    >
                      {formatRelative(event.at)}
                    </time>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>
      </div>

      <Panel
        id="usage"
        title="Usage"
        testId="usage"
        aside={
          usage.data && (
            <span className="text-xs text-fg-muted">
              {new Date(usage.data.period.from).toLocaleDateString()} to{' '}
              {new Date(usage.data.period.to).toLocaleDateString()}
            </span>
          )
        }
      >
        {usage.isPending ? (
          <Loading />
        ) : usage.error ? (
          <Failed
            what="usage"
            onRetry={async () => {
              await usage.refetch();
            }}
          />
        ) : (
          <div className="p-4">
            <MetricGroup>
              <Metric
                label="Runs"
                value={usage.data.runs.total}
                unit={`${usage.data.runs.succeeded} succeeded`}
                data-metric="runs"
              />
              <Metric
                label="Needs attention"
                value={
                  usage.data.runs.failed +
                  usage.data.runs.partial +
                  usage.data.runs.unverified
                }
                unit="failed, partial or unverified"
                data-metric="attention"
              />
              <Metric
                label="Sandbox time"
                value={formatDuration(usage.data.sandboxSeconds * 1000)}
                data-metric="sandbox"
              />
              <Metric
                label="Tokens"
                value={formatCompact(
                  usage.data.tokens.reduce(
                    (sum, { input, output }) => sum + input + output,
                    0,
                  ),
                )}
                data-metric="tokens"
              />
              {usage.data.cost.kind === 'unavailable' ? (
                <Metric
                  label="Cost"
                  unavailable={usage.data.cost.reason}
                  data-metric="cost"
                />
              ) : (
                <Metric
                  label="Cost"
                  value={formatCurrency(usage.data.cost.amountUsd)}
                  estimate={usage.data.cost.kind === 'estimate'}
                  data-metric="cost"
                />
              )}
              <Metric
                label="Monthly runs"
                value={usage.data.quotas.monthlyRuns.used}
                unit={
                  usage.data.quotas.monthlyRuns.max === null
                    ? 'no limit'
                    : `of ${usage.data.quotas.monthlyRuns.max}`
                }
                data-metric="monthly-runs"
              />
            </MetricGroup>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Panel({
  id,
  title,
  testId,
  aside,
  children,
}: {
  id: string;
  title: string;
  testId: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-testid={testId}
      className="material-solid"
    >
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <h2 id={`${id}-title`} className="text-sm font-semibold">
          {title}
        </h2>
        <div className="ml-auto">{aside}</div>
      </div>
      {children}
    </section>
  );
}

const Loading = () => (
  <div className="p-4" aria-busy="true">
    <SkeletonText lines={3} />
  </div>
);

const Failed = ({
  what,
  onRetry,
}: {
  what: string;
  onRetry: () => Promise<void>;
}) => (
  <ErrorState
    title={`Could not load ${what}`}
    description="The API did not answer. Nothing shown here is current."
    onRetry={onRetry}
  />
);
