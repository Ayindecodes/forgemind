'use client';

import type { GitHubRepository } from '@forgemind/contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { AuthCard } from '@/components/auth/auth-card';
import { GitHubMark } from '@/components/brand/github-mark';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SkeletonText } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { Status, type StatusValue } from '@/components/ui/status';
import { request } from '@/lib/api-client';
import { cx } from '@/lib/cx';
import { formatRelative } from '@/lib/format';
import { keys, useRepositories, useSession } from '@/lib/queries';

const permissions = [
  ['Metadata', 'read', 'List the repositories you choose.'],
  [
    'Contents',
    'write',
    'Read code and push working branches. Never the default branch.',
  ],
  ['Pull requests', 'write', 'Open pull requests for you to review.'],
  ['Checks', 'read', 'Read CI results on pull requests.'],
  ['Webhooks', 'read', 'Hear about pushes and pull request changes.'],
] as const;

const notRequested = [
  'Administration',
  'Actions',
  'Secrets',
  'Members',
  'Billing',
];

type StepId = 'organization' | 'install' | 'repositories' | 'done';

const steps: { id: StepId; label: string }[] = [
  { id: 'organization', label: 'Organization' },
  { id: 'install', label: 'GitHub App' },
  { id: 'repositories', label: 'Repositories' },
  { id: 'done', label: 'Ready' },
];

export function Onboarding() {
  const session = useSession();
  const client = useQueryClient();
  const hasOrganization =
    session.data?.organizationId !== null && session.data !== undefined;

  const installation = useQuery({
    queryKey: ['installation'],
    queryFn: ({ signal }) => request('installation', { signal }),
    enabled: hasOrganization,
  });
  const repositories = useRepositories(hasOrganization);
  const connected = (repositories.data?.items ?? []).filter(
    ({ status }) => status !== 'revoked',
  );
  const indexing = connected.some(({ status }) => status === 'analyzing');

  const current: StepId = !hasOrganization
    ? 'organization'
    : installation.data?.installation === null
      ? 'install'
      : connected.length === 0
        ? 'repositories'
        : 'done';

  const statusOf = (id: StepId): StatusValue => {
    const index = steps.findIndex((step) => step.id === id);
    const currentIndex = steps.findIndex((step) => step.id === current);
    if (index < currentIndex) return 'passed';
    // The last step is only done once every repository has been indexed.
    if (current === 'done')
      return id === 'done' && indexing ? 'running' : 'passed';
    return index === currentIndex ? 'running' : 'pending';
  };

  const loading =
    session.isPending ||
    (hasOrganization && (installation.isPending || repositories.isPending));

  return (
    <AuthCard
      wide
      title="Set up ForgeMind"
      description="Three steps, each one reversible later from Settings."
    >
      <div className="grid gap-8 md:grid-cols-[12rem_1fr]">
        <ol className="flex flex-col gap-3" aria-label="Setup steps">
          {steps.map((step, index) => (
            <li key={step.id} className="flex items-center gap-2">
              <Status
                status={statusOf(step.id)}
                label={`${index + 1}. ${step.label}`}
                size="sm"
                className={cx(step.id !== current && 'text-fg-secondary')}
              />
            </li>
          ))}
        </ol>

        <div data-testid={`onboarding-${current}`} className="min-w-0">
          {loading ? (
            <SkeletonText lines={4} />
          ) : current === 'organization' ? (
            <OrganizationStep
              onDone={() =>
                client.invalidateQueries({ queryKey: keys.session })
              }
            />
          ) : current === 'install' ? (
            <InstallStep />
          ) : current === 'repositories' ? (
            <RepositoriesStep />
          ) : (
            <DoneStep />
          )}
        </div>
      </div>
    </AuthCard>
  );
}

function OrganizationStep({ onDone }: { onDone: () => void }) {
  const session = useSession();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => request('createOrganization', { body: { name } }),
    onSuccess: onDone,
  });
  const invalid = name.trim().length > 0 && name.trim().length < 2;

  return (
    <form
      className="flex max-w-md flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim().length >= 2) create.mutate();
      }}
    >
      <p className="text-fg-secondary">
        Welcome, {session.data?.user.name}. An organization holds your
        repositories, tasks and teammates.
      </p>
      <Field
        label="Organization name"
        description="You can rename it later."
        error={invalid ? 'Use at least two characters.' : undefined}
      >
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Rivera Labs"
          autoFocus
          data-testid="organization-name"
        />
      </Field>
      {create.error && (
        <p className="text-sm text-error-fg">{create.error.message}</p>
      )}
      <Button
        type="submit"
        variant="primary"
        loading={create.isPending}
        disabled={name.trim().length < 2}
        className="self-start"
      >
        Create organization
      </Button>
    </form>
  );
}

function InstallStep() {
  const start = useMutation({
    mutationFn: () => request('installStart', {}),
    onSuccess: ({ url }) => window.location.assign(url),
  });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-fg-secondary">
        ForgeMind works through a GitHub App you install on your account, on the
        repositories you pick. It asks only for this:
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-fg-muted">
            <th className="py-1 pr-3 font-medium">Permission</th>
            <th className="py-1 pr-3 font-medium">Access</th>
            <th className="py-1 font-medium">Why</th>
          </tr>
        </thead>
        <tbody>
          {permissions.map(([name, access, reason]) => (
            <tr key={name} className="border-t border-line-subtle align-top">
              <td className="py-1.5 pr-3 font-medium whitespace-nowrap">
                {name}
              </td>
              <td className="py-1.5 pr-3">
                <Badge tone={access === 'write' ? 'accent' : 'neutral'}>
                  {access}
                </Badge>
              </td>
              <td className="py-1.5 text-fg-secondary">{reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm text-fg-muted">
        Not requested: {notRequested.join(', ')}. ForgeMind never merges or
        deploys on its own.
      </p>
      {start.error && (
        <p className="text-sm text-error-fg">{start.error.message}</p>
      )}
      <Button
        variant="primary"
        icon={<GitHubMark />}
        loading={start.isPending}
        onClick={() => start.mutate()}
        className="self-start"
        data-testid="install-github"
      >
        Install on GitHub
      </Button>
    </div>
  );
}

function RepositoriesStep() {
  const client = useQueryClient();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const available = useQuery({
    queryKey: ['github-repositories'],
    queryFn: ({ signal }) => request('githubRepositories', { signal }),
  });

  const connect = useMutation({
    mutationFn: async (chosen: GitHubRepository[]) => {
      for (const repo of chosen) {
        await request('connectRepository', {
          body: { githubId: repo.githubId, fullName: repo.fullName },
        });
      }
    },
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.repositories }),
        client.invalidateQueries({ queryKey: ['github-repositories'] }),
      ]),
  });

  if (available.isPending) return <SkeletonText lines={5} />;
  if (available.error || !available.data) {
    return (
      <ErrorState
        title="Could not list your repositories"
        description={available.error?.message}
        onRetry={() => available.refetch().then(() => undefined)}
      />
    );
  }

  const chosen = available.data.filter(({ githubId }) =>
    selected.has(githubId),
  );
  const toggle = (githubId: number, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(githubId);
      else next.delete(githubId);
      return next;
    });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-fg-secondary">
        Choose what ForgeMind may analyse. Each repository is indexed once, then
        kept up to date from pushes.
      </p>
      <ul className="material-solid divide-y divide-line-subtle">
        {available.data.map((repo) => (
          <li
            key={repo.githubId}
            className="flex items-center gap-3 px-3 py-2.5"
          >
            <Checkbox
              label={repo.fullName}
              description={repo.description ?? undefined}
              checked={selected.has(repo.githubId)}
              disabled={
                repo.connectedRepositoryId !== null || connect.isPending
              }
              onCheckedChange={(value) => toggle(repo.githubId, value === true)}
              className="min-w-0 flex-1"
              data-testid={`repo-${repo.githubId}`}
            />
            <span className="shrink-0 text-xs text-fg-muted">
              {repo.connectedRepositoryId ? (
                <Badge tone="success">Connected</Badge>
              ) : (
                `pushed ${formatRelative(repo.pushedAt)}`
              )}
            </span>
          </li>
        ))}
      </ul>
      {connect.error && (
        <p className="text-sm text-error-fg">{connect.error.message}</p>
      )}
      <Button
        variant="primary"
        loading={connect.isPending}
        disabled={chosen.length === 0}
        onClick={() => connect.mutate(chosen)}
        className="self-start"
        data-testid="connect-repositories"
      >
        {chosen.length <= 1
          ? 'Connect repository'
          : `Connect ${chosen.length} repositories`}
      </Button>
    </div>
  );
}

function DoneStep() {
  const client = useQueryClient();
  const repositories = useRepositories(true, { liveWhileAnalyzing: true });
  const connected = (repositories.data?.items ?? []).filter(
    ({ status }) => status !== 'revoked',
  );
  const first = connected[0];
  if (!first) return null;
  const open = connected.find(({ status }) => status === 'connected') ?? first;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-fg-secondary">
        {connected.length === 1 ? (
          <>
            <span className="font-mono text-code text-fg">
              {first.fullName}
            </span>{' '}
            is connected.
          </>
        ) : (
          `${connected.length} repositories are connected.`
        )}
      </p>
      <ul className="flex flex-col gap-2" aria-label="Connected repositories">
        {connected.map((repo) => (
          <li
            key={repo.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
          >
            {connected.length > 1 && (
              <span className="font-mono text-code text-fg">
                {repo.fullName}
              </span>
            )}
            <Status
              status={
                repo.status === 'analyzing'
                  ? 'running'
                  : repo.status === 'connected'
                    ? 'passed'
                    : 'failed'
              }
              label={
                repo.status === 'analyzing'
                  ? 'Indexing the repository'
                  : repo.status === 'connected'
                    ? 'Indexed and ready'
                    : (repo.statusMessage ?? 'Connection problem')
              }
            />
          </li>
        ))}
      </ul>
      <Button
        asChild
        variant="primary"
        icon={<ArrowRight />}
        className="self-start"
        onClick={() => client.invalidateQueries({ queryKey: keys.session })}
      >
        <Link href={`/repositories/${open.id}`} data-testid="open-repository">
          Open {open.fullName}
        </Link>
      </Button>
    </div>
  );
}
