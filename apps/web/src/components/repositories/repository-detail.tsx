'use client';

import type { Repository, RepositoryAnalysis, Task } from '@forgemind/contract';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { PageHeader } from '@/components/shell/page-header';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SkeletonText } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Status, type StatusValue } from '@/components/ui/status';
import { ApiRequestError, request } from '@/lib/api-client';
import { formatRelative } from '@/lib/format';

/*
 * One repository: what the analysis found about it, with every piece of
 * evidence linked to the code it came from at the analysed commit, and the
 * tasks and findings that touched it. When the analysis is not there yet
 * the page says why rather than filling the gap.
 */

const taskStatus: Record<Task['status'], StatusValue> = {
  queued: 'pending',
  running: 'running',
  awaiting_approval: 'awaiting',
  completed: 'passed',
  failed: 'failed',
  cancelled: 'cancelled',
};

const importanceTone: Record<
  RepositoryAnalysis['modules'][number]['importance'],
  BadgeTone
> = { core: 'accent', supporting: 'neutral', peripheral: 'neutral' };

const severityTone: Record<string, BadgeTone> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'neutral',
  info: 'info',
};

/** A link to a file, and a line, at the commit the analysis read. */
export const codeHref = (
  repository: Repository,
  commit: string,
  path: string,
  line: number | null,
) =>
  `${repository.url}/blob/${commit}/${path}${line !== null ? `#L${line}` : ''}`;

export function RepositoryDetail({ id }: { id: string }) {
  const repository = useQuery({
    queryKey: ['repository', id],
    queryFn: ({ signal }) => request('repository', { params: { id }, signal }),
  });
  const analysis = useQuery({
    queryKey: ['repository-analysis', id],
    queryFn: ({ signal }) =>
      request('repositoryAnalysis', { params: { id }, signal }),
    enabled: repository.data?.status === 'connected',
    retry: false,
  });
  const tasks = useQuery({
    queryKey: ['repository-tasks', id],
    queryFn: ({ signal }) =>
      request('tasks', { query: { repositoryId: id, limit: 50 }, signal }),
  });
  const findings = useQuery({
    queryKey: ['repository-findings', id],
    queryFn: ({ signal }) =>
      request('findings', { query: { repositoryId: id, limit: 200 }, signal }),
  });

  if (repository.isPending) {
    return (
      <div className="material-solid p-4" aria-busy="true">
        <SkeletonText lines={6} />
      </div>
    );
  }
  if (
    repository.error instanceof ApiRequestError &&
    repository.error.code === 'not_found'
  ) {
    return (
      <PageHeader
        title="Repository not found"
        description={`No repository has the id ${id}.`}
      />
    );
  }
  if (repository.error || !repository.data) {
    return (
      <div className="material-solid">
        <ErrorState
          title="Could not load the repository"
          onRetry={async () => {
            await repository.refetch();
          }}
        />
      </div>
    );
  }

  const repo = repository.data;
  const report = analysis.data ?? null;

  return (
    <div className="flex flex-col gap-6" data-testid="repository-detail">
      <PageHeader
        title={repo.fullName}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {repo.private ? 'Private' : 'Public'}, default branch{' '}
              <span className="font-mono">{repo.defaultBranch}</span>, pushed{' '}
              {formatRelative(repo.pushedAt)}.
            </span>
            <Button asChild size="sm" variant="ghost" icon={<ExternalLink />}>
              <a href={repo.url} target="_blank" rel="noreferrer">
                GitHub
              </a>
            </Button>
          </span>
        }
        actions={
          <Status
            status={
              repo.status === 'connected'
                ? 'passed'
                : repo.status === 'analyzing'
                  ? 'running'
                  : repo.status === 'error'
                    ? 'failed'
                    : 'cancelled'
            }
            label={
              repo.status === 'connected' && repo.lastAnalyzedAt
                ? `Indexed ${formatRelative(repo.lastAnalyzedAt)} at ${repo.lastAnalyzedCommit ?? ''}`
                : (repo.statusMessage ?? undefined)
            }
          />
        }
      />

      {repo.status !== 'connected' ? (
        <div className="material-solid" data-testid="analysis-missing">
          <EmptyState
            title={
              repo.status === 'analyzing'
                ? 'Indexing in progress'
                : 'No analysis available'
            }
            description={
              repo.status === 'analyzing'
                ? 'The analysis appears once indexing finishes.'
                : (repo.statusMessage ??
                  'ForgeMind cannot read this repository right now.')
            }
          />
        </div>
      ) : analysis.isPending ? (
        <div className="material-solid p-4" aria-busy="true">
          <SkeletonText lines={6} />
        </div>
      ) : analysis.error || !report ? (
        <div className="material-solid" data-testid="analysis-missing">
          <ErrorState
            title="The analysis did not come back"
            onRetry={async () => {
              await analysis.refetch();
            }}
          />
        </div>
      ) : (
        <AnalysisReport repository={repo} report={report} />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          id="findings"
          title={`Findings (${findings.data?.items.length ?? 0})`}
          testId="repository-findings"
        >
          {findings.isPending ? (
            <Loading />
          ) : findings.error ? (
            <p className="px-4 py-3 text-sm text-error-fg">
              Could not load findings.
            </p>
          ) : findings.data.items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-fg-secondary">
              No findings on this repository.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {findings.data.items.map((finding) => (
                <li
                  key={finding.id}
                  className="flex flex-col gap-1 px-4 py-2.5 text-sm"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={severityTone[finding.severity] ?? 'neutral'}>
                      {finding.severity}
                    </Badge>
                    <span className="font-medium">{finding.title}</span>
                    <Badge>{finding.status}</Badge>
                  </span>
                  <a
                    href={codeHref(
                      repo,
                      repo.lastAnalyzedCommit ?? repo.defaultBranch,
                      finding.location.path,
                      finding.location.line,
                    )}
                    target="_blank"
                    rel="noreferrer"
                    className="touch-target font-mono text-xs text-fg-secondary hover:underline"
                    data-testid="finding-location"
                  >
                    {finding.location.path}
                    {finding.location.line !== null &&
                      `:${finding.location.line}`}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          id="tasks"
          title={`Task history (${tasks.data?.items.length ?? 0})`}
          testId="repository-tasks"
        >
          {tasks.isPending ? (
            <Loading />
          ) : tasks.error ? (
            <p className="px-4 py-3 text-sm text-error-fg">
              Could not load tasks.
            </p>
          ) : tasks.data.items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-fg-secondary">
              No task has run on this repository.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {tasks.data.items.map((task) => (
                <li key={task.id}>
                  <Link
                    href={`/tasks/${task.id}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm hover:bg-hover"
                    data-testid={`history-${task.id}`}
                  >
                    <span className="min-w-0 flex-1 basis-48 truncate">
                      {task.title}
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
      </div>
    </div>
  );
}

function AnalysisReport({
  repository,
  report,
}: {
  repository: Repository;
  report: RepositoryAnalysis;
}) {
  const link = (path: string, line: number | null = null) => (
    <a
      href={codeHref(repository, report.commit, path, line)}
      target="_blank"
      rel="noreferrer"
      className="touch-target font-mono text-xs hover:underline"
      data-testid="code-link"
    >
      {path}
      {line !== null && `:${line}`}
    </a>
  );
  const vulnerable = report.dependencies.filter((dep) => dep.vulnerable);

  return (
    <section
      aria-labelledby="analysis-title"
      data-testid="analysis"
      data-commit={report.commit}
      className="material-solid"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <h2 id="analysis-title" className="text-sm font-semibold">
          Analysis
        </h2>
        <span className="text-xs text-fg-muted">
          at <span className="font-mono">{report.commit}</span>,{' '}
          {formatRelative(report.analyzedAt)}
        </span>
      </header>
      <dl className="grid gap-x-8 gap-y-4 px-4 py-4 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Row title="Summary">
          <p>{report.summary}</p>
          {report.frameworks.length > 0 && (
            <p className="mt-1 flex flex-wrap gap-1">
              {report.frameworks.map((framework) => (
                <Badge key={framework}>{framework}</Badge>
              ))}
            </p>
          )}
        </Row>
        <Row title="Entry points">
          {report.entryPoints.length === 0 ? (
            <Missing>None identified.</Missing>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {report.entryPoints.map((entry) => (
                <li key={entry.path} className="flex items-center gap-2">
                  {link(entry.path)}
                  <span className="text-xs text-fg-muted">{entry.kind}</span>
                </li>
              ))}
            </ul>
          )}
        </Row>
        <Row title="Architecture">
          {report.modules.length === 0 ? (
            <Missing>No modules identified.</Missing>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {report.modules.map((module) => (
                <li
                  key={module.path}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
                >
                  <span className="font-medium">{module.name}</span>
                  <Badge tone={importanceTone[module.importance]}>
                    {module.importance}
                  </Badge>
                  {link(module.path)}
                  <span className="basis-full text-fg-secondary">
                    {module.description}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Row>
        <Row title="Languages">
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {repository.languages.map((language) => (
              <li key={language.name} className="tabular-nums">
                {language.name}{' '}
                <span className="text-fg-muted">
                  {Math.round(language.share * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </Row>
        <Row title="Dependencies">
          {report.dependencies.length === 0 ? (
            <Missing>None recorded.</Missing>
          ) : (
            <>
              {vulnerable.length > 0 && (
                <p
                  className="mb-1 text-warning-fg"
                  data-testid="vulnerable-count"
                >
                  {vulnerable.length} with a known advisory.
                </p>
              )}
              <ul className="flex flex-col gap-0.5">
                {report.dependencies.map((dep) => (
                  <li
                    key={`${dep.ecosystem}-${dep.name}`}
                    className="flex flex-wrap items-center gap-2 font-mono text-xs"
                    data-vulnerable={dep.vulnerable || undefined}
                  >
                    <span>
                      {dep.name}@{dep.version}
                    </span>
                    <span className="text-fg-muted">{dep.ecosystem}</span>
                    {dep.vulnerable && <Badge tone="error">vulnerable</Badge>}
                    {dep.advisoryUrl && (
                      <a
                        href={dep.advisoryUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="touch-target font-sans text-fg-secondary hover:underline"
                      >
                        advisory
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Row>
        <Row title="Tests and builds">
          {report.testCommands.length + report.buildCommands.length === 0 ? (
            <Missing>No commands identified.</Missing>
          ) : (
            <ul className="flex flex-col gap-0.5 font-mono text-xs">
              {report.testCommands.map((command) => (
                <li key={`test-${command}`}>$ {command}</li>
              ))}
              {report.buildCommands.map((command) => (
                <li key={`build-${command}`}>$ {command}</li>
              ))}
            </ul>
          )}
        </Row>
        <Row title="Documentation">
          {report.documentation.length === 0 ? (
            <Missing>None found.</Missing>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {report.documentation.map((doc) => (
                <li key={doc.path} className="flex items-center gap-2">
                  <span>{doc.title}</span>
                  {link(doc.path)}
                </li>
              ))}
            </ul>
          )}
        </Row>
        <Row title="Concerns">
          {report.concerns.length === 0 ? (
            <Missing>None raised.</Missing>
          ) : (
            <ul className="flex flex-col gap-3">
              {report.concerns.map((concern) => (
                <li key={concern.title} data-testid="concern">
                  <p className="font-medium">{concern.title}</p>
                  <p className="text-fg-secondary">{concern.detail}</p>
                  {concern.evidence.length === 0 ? (
                    <Missing>
                      No evidence was recorded for this concern.
                    </Missing>
                  ) : (
                    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                      {concern.evidence.map((location) => (
                        <li key={`${location.path}:${location.line}`}>
                          {link(location.path, location.line)}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Row>
      </dl>
    </section>
  );
}

function Row({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="contents" data-row={title}>
      <dt className="font-semibold">{title}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Panel({
  id,
  title,
  testId,
  children,
}: {
  id: string;
  title: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-testid={testId}
      className="material-solid"
    >
      <h2
        id={`${id}-title`}
        className="border-b border-line px-4 py-3 text-sm font-semibold"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

const Loading = () => (
  <div className="p-4" aria-busy="true">
    <SkeletonText lines={3} />
  </div>
);

const Missing = ({ children }: { children: ReactNode }) => (
  <p className="text-fg-secondary italic" data-testid="analysis-missing-item">
    {children}
  </p>
);
