'use client';

import type { Finding, Repository, Severity } from '@forgemind/contract';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';

import { PageHeader } from '@/components/shell/page-header';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectItem } from '@/components/ui/select';
import { SkeletonText } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { request } from '@/lib/api-client';
import {
  categoryLabels,
  confidenceLabels,
  countBySeverity,
  filterFindings,
  splitByConfidence,
} from '@/lib/findings';
import { formatRelative } from '@/lib/format';
import { useRepositories } from '@/lib/queries';
import { codeHref } from '@/lib/repositories';

/*
 * Every finding across the organisation's repositories. Confirmed findings
 * and suspicions sit in separate lists with separate headings, and each
 * card says which it is, so a hunch is never read as a fact.
 */

const severityTone: Record<Severity, BadgeTone> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'neutral',
  info: 'info',
};

const severities: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export function SecurityPage() {
  const findings = useQuery({
    queryKey: ['findings', 'all'],
    queryFn: ({ signal }) =>
      request('findings', { query: { limit: 200 }, signal }),
  });
  const repositories = useRepositories();
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState<Severity | 'all'>('all');
  const [repositoryId, setRepositoryId] = useState('all');
  const [showFixed, setShowFixed] = useState(false);

  const all = useMemo(() => findings.data?.items ?? [], [findings.data]);
  const shown = useMemo(
    () =>
      filterFindings(all, {
        query,
        severity,
        repositoryId: repositoryId === 'all' ? null : repositoryId,
        showFixed,
      }),
    [all, query, severity, repositoryId, showFixed],
  );
  const { confirmed, suspicions } = splitByConfidence(shown);
  const repos = new Map(
    (repositories.data?.items ?? []).map((repo) => [repo.id, repo]),
  );
  const openCounts = countBySeverity(
    all.filter(({ status }) => status === 'open'),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Security"
        description="Findings across repositories, with evidence and remediation. Confirmed findings and suspicions are kept apart."
      />

      <section
        aria-label="Open findings by severity"
        data-testid="severity-summary"
        className="material-solid flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm"
      >
        {severities.map((level) => (
          <span key={level} className="flex items-center gap-2 tabular-nums">
            <Badge tone={severityTone[level]}>{level}</Badge>
            <span data-severity-count={level}>{openCounts[level]}</span>
          </span>
        ))}
        <span className="ml-auto text-fg-secondary">
          {all.filter(({ status }) => status === 'open').length} open,{' '}
          {all.filter(({ status }) => status !== 'open').length} fixed or
          dismissed
        </span>
      </section>

      <div className="material-solid flex flex-wrap items-center gap-3 px-4 py-3">
        <Input
          type="search"
          icon={<Search />}
          placeholder="Search by title, path or tool"
          aria-label="Search findings"
          data-testid="finding-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-64"
        />
        <div className="w-40">
          <Select
            aria-label="Severity"
            value={severity}
            onValueChange={(value) => setSeverity(value as Severity | 'all')}
            data-testid="finding-severity-filter"
          >
            <SelectItem value="all">All severities</SelectItem>
            {severities.map((level) => (
              <SelectItem key={level} value={level}>
                {level}
              </SelectItem>
            ))}
          </Select>
        </div>
        <div className="w-52">
          <Select
            aria-label="Repository"
            value={repositoryId}
            onValueChange={setRepositoryId}
            data-testid="finding-repository-filter"
          >
            <SelectItem value="all">All repositories</SelectItem>
            {(repositories.data?.items ?? []).map((repo) => (
              <SelectItem key={repo.id} value={repo.id}>
                {repo.fullName}
              </SelectItem>
            ))}
          </Select>
        </div>
        <Switch
          label="Show fixed"
          checked={showFixed}
          onCheckedChange={setShowFixed}
          data-testid="show-fixed"
        />
        <span
          className="ml-auto text-sm text-fg-secondary tabular-nums"
          data-testid="finding-count"
        >
          {shown.length} of {all.length}
        </span>
      </div>

      {findings.isPending ? (
        <div className="material-solid p-4" aria-busy="true">
          <SkeletonText lines={6} />
        </div>
      ) : findings.error ? (
        <div className="material-solid">
          <ErrorState
            title="Could not load findings"
            onRetry={async () => {
              await findings.refetch();
            }}
          />
        </div>
      ) : shown.length === 0 ? (
        <div className="material-solid">
          <EmptyState
            title={all.length === 0 ? 'No findings' : 'Nothing matches'}
            description={
              all.length === 0
                ? 'Scans and reviews raise findings here as runs happen.'
                : 'Try other words, or widen the filters.'
            }
          />
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <Group
            id="confirmed"
            title="Confirmed"
            tone="error"
            note="Each one has evidence from the code or a known advisory."
            findings={confirmed}
            repos={repos}
            empty="No confirmed findings match."
          />
          <Group
            id="suspicions"
            title="Suspicions"
            tone="warning"
            note="Raised but not proven. Treat as leads until confirmed."
            findings={suspicions}
            repos={repos}
            empty="No suspicions match."
          />
        </div>
      )}
    </div>
  );
}

function Group({
  id,
  title,
  tone,
  note,
  findings,
  repos,
  empty,
}: {
  id: string;
  title: string;
  tone: BadgeTone;
  note: string;
  findings: Finding[];
  repos: Map<string, Repository>;
  empty: string;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-testid={`findings-${id}`}
      data-count={findings.length}
      className="material-solid"
    >
      <header className="flex flex-wrap items-baseline gap-2 border-b border-line px-4 py-3">
        <h2 id={`${id}-title`} className="text-sm font-semibold">
          {title} ({findings.length})
        </h2>
        <span className="text-xs text-fg-secondary">{note}</span>
      </header>
      {findings.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-fg-secondary">
          {empty}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {findings.map((finding) => (
            <FindingCard
              key={finding.id}
              finding={finding}
              repository={repos.get(finding.repositoryId)}
              tone={tone}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function FindingCard({
  finding,
  repository,
  tone,
}: {
  finding: Finding;
  repository: Repository | undefined;
  tone: BadgeTone;
}) {
  const location = `${finding.location.path}${finding.location.line !== null ? `:${finding.location.line}` : ''}`;
  const href = repository
    ? codeHref(
        repository,
        repository.lastAnalyzedCommit ?? repository.defaultBranch,
        finding.location.path,
        finding.location.line,
      )
    : null;

  return (
    <li
      data-testid={`finding-${finding.id}`}
      data-confidence={finding.confidence}
      data-severity={finding.severity}
      className="flex flex-col gap-2 px-4 py-3 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={severityTone[finding.severity]}>{finding.severity}</Badge>
        <span className="font-medium">{finding.title}</span>
        <Badge tone={tone} data-testid="confidence">
          {confidenceLabels[finding.confidence]}
        </Badge>
        {finding.status !== 'open' && <Badge>{finding.status}</Badge>}
      </div>
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[7rem_minmax(0,1fr)]">
        <Term>Where</Term>
        <dd className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {repository && (
            <Link
              href={`/repositories/${repository.id}`}
              className="touch-target font-mono text-xs hover:underline"
            >
              {repository.fullName}
            </Link>
          )}
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="touch-target font-mono text-xs hover:underline"
              data-testid="finding-code"
            >
              {location}
            </a>
          ) : (
            <span className="font-mono text-xs">{location}</span>
          )}
          <span className="text-xs text-fg-muted">
            {categoryLabels[finding.category]}, by {finding.tool},{' '}
            {formatRelative(finding.detectedAt)}
          </span>
        </dd>
        <Term>Evidence</Term>
        <dd>
          {finding.evidence ? (
            <span className="text-fg-secondary">{finding.evidence}</span>
          ) : (
            <span className="text-warning-fg" data-testid="no-evidence">
              No evidence was recorded by {finding.tool}.
            </span>
          )}
        </dd>
        <Term>Remediation</Term>
        <dd className="text-fg-secondary">{finding.remediation}</dd>
        {finding.advisoryUrl && (
          <>
            <Term>Advisory</Term>
            <dd>
              <Button asChild size="sm" variant="ghost" icon={<ExternalLink />}>
                <a
                  href={finding.advisoryUrl}
                  target="_blank"
                  rel="noreferrer"
                  data-testid="advisory"
                >
                  {finding.advisoryUrl.replace(/^https?:\/\//, '')}
                </a>
              </Button>
            </dd>
          </>
        )}
      </dl>
    </li>
  );
}

const Term = ({ children }: { children: ReactNode }) => (
  <dt className="text-xs font-medium text-fg-secondary uppercase">
    {children}
  </dt>
);
