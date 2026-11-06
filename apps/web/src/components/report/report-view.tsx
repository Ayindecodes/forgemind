'use client';

import type { Report, Run } from '@forgemind/contract';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';

import { checkStatus } from '@/components/run/timeline';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { SkeletonText } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Status, type StatusValue } from '@/components/ui/status';
import { ApiRequestError, request } from '@/lib/api-client';
import { formatDuration } from '@/lib/format';
import { useTask } from '@/lib/queries';
import { reportToMarkdown } from '@/lib/report/markdown';
import { usePrintTheme } from '@/lib/use-print-theme';

/*
 * The engineering report: the structured record of a finished run, every
 * field the spec lists, in its order. It is read from the API each time, so
 * it reopens later exactly as the run left it, and it links back to the
 * diff, the checks, the events and the logs it summarises.
 */

const outcomeStatus: Record<Report['outcome'], StatusValue> = {
  succeeded: 'passed',
  partial: 'partial',
  failed: 'failed',
  unverified: 'unverified',
};

const severityTone: Record<Report['findings'][number]['severity'], BadgeTone> =
  {
    critical: 'error',
    high: 'error',
    medium: 'warning',
    low: 'neutral',
    info: 'info',
  };

const runLabel = (run: Run, index: number) =>
  `Run ${index + 1}${run.outcome ? `, ${run.outcome}` : `, ${run.status.replace('_', ' ')}`}`;

export function ReportView({ taskId }: { taskId: string }) {
  usePrintTheme();
  const params = useSearchParams();
  const task = useTask(taskId);
  const runs = useQuery({
    queryKey: ['task-runs', taskId],
    queryFn: ({ signal }) =>
      request('taskRuns', { params: { id: taskId }, signal }),
  });
  const runId = params.get('run') ?? task.data?.runId;
  const report = useQuery({
    queryKey: ['report', runId],
    queryFn: ({ signal }) =>
      request('runReport', { params: { id: runId ?? '' }, signal }),
    enabled: runId !== undefined,
    retry: false,
  });

  if (task.error || (!task.isPending && !task.data)) return null;
  if (
    report.error instanceof ApiRequestError &&
    report.error.code === 'conflict'
  ) {
    return (
      <div className="material-solid">
        <EmptyState
          title="No report yet"
          description="The report is written when the run finishes. Follow the run until then."
          action={
            <Button asChild variant="secondary">
              <Link href={`/tasks/${taskId}`}>Follow the run</Link>
            </Button>
          }
        />
      </div>
    );
  }
  if (report.error) {
    return (
      <div className="material-solid">
        <ErrorState
          title="Could not load the report"
          onRetry={async () => {
            await report.refetch();
          }}
        />
      </div>
    );
  }
  if (task.isPending || report.isPending || !report.data || !task.data) {
    return (
      <div className="material-solid p-4" aria-busy="true">
        <SkeletonText lines={8} />
      </div>
    );
  }

  const data = report.data;
  const base = `/tasks/${taskId}`;
  const passed = data.checks.filter(
    (check) => check.status === 'passed',
  ).length;
  const failed = data.checks.filter(
    (check) => check.status === 'failed' || check.status === 'error',
  ).length;
  const notRun = data.checks.length - passed - failed;

  return (
    <article
      data-testid="report"
      data-run={data.runId}
      className="flex flex-col gap-4 print:gap-6"
    >
      <section
        aria-label="Report actions"
        className="material-solid flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 print:hidden"
      >
        <Button asChild size="sm" variant="ghost" icon={<ArrowLeft />}>
          <Link href={base}>Run</Link>
        </Button>
        {runs.data && runs.data.length > 1 && (
          <nav aria-label="Runs" className="flex flex-wrap items-center gap-1">
            {runs.data.map((run, index) => (
              <Button
                key={run.id}
                asChild
                size="sm"
                variant={run.id === data.runId ? 'secondary' : 'ghost'}
              >
                <Link
                  href={`${base}/report?run=${run.id}`}
                  aria-current={run.id === data.runId ? 'page' : undefined}
                  data-testid={`report-run-${run.id}`}
                >
                  {runLabel(run, index)}
                </Link>
              </Button>
            ))}
          </nav>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="secondary">
            <Link href={`${base}/review`} data-testid="report-review">
              Review the patch
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href={`${base}#checks`} data-testid="report-checks">
              Checks
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href={`${base}#events`} data-testid="report-events">
              Events
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href={`${base}#logs`} data-testid="report-logs">
              Logs
            </Link>
          </Button>
          <CopyButton
            label="Copy as Markdown"
            text={() => reportToMarkdown(data)}
          />
          <Button
            size="sm"
            variant="primary"
            icon={<Printer />}
            onClick={() => window.print()}
            data-testid="print-report"
          >
            Print
          </Button>
        </div>
      </section>

      <div className="material-solid print:border-0 print:shadow-none">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Engineering report</h2>
            <p className="text-sm text-fg-secondary">
              Run {data.runId}, generated{' '}
              <time dateTime={data.generatedAt}>
                {new Date(data.generatedAt).toLocaleString()}
              </time>
            </p>
          </div>
          <Status status={outcomeStatus[data.outcome]} />
        </header>

        <dl className="grid gap-x-8 gap-y-5 px-5 py-5 sm:grid-cols-[11rem_minmax(0,1fr)]">
          <Section name="task" title="Original task">
            <p className="whitespace-pre-wrap">{data.task}</p>
          </Section>
          <Section name="repository" title="Repository and commit">
            <p>
              <span className="font-mono">{data.repositoryFullName}</span> at{' '}
              <span className="font-mono">{data.commit}</span>
            </p>
          </Section>
          <Section name="investigation" title="Investigation summary">
            <p className="whitespace-pre-wrap">{data.investigation}</p>
          </Section>
          <Section name="root-cause" title="Root cause">
            {data.rootCause ? (
              <p className="whitespace-pre-wrap">{data.rootCause}</p>
            ) : (
              <Missing>Not established.</Missing>
            )}
          </Section>
          <Section name="files" title="Files modified">
            {data.filesModified.length === 0 ? (
              <Missing>No files were modified.</Missing>
            ) : (
              <ul className="flex flex-col gap-0.5 font-mono text-xs">
                {data.filesModified.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
            )}
          </Section>
          <Section name="changes" title="Changes implemented">
            <p className="whitespace-pre-wrap">{data.changes}</p>
          </Section>
          <Section name="commands" title="Commands executed">
            {data.commands.length === 0 ? (
              <Missing>No commands were executed.</Missing>
            ) : (
              <ol className="flex flex-col gap-0.5 font-mono text-xs">
                {data.commands.map((command, index) => (
                  <li key={`${index}-${command}`}>$ {command}</li>
                ))}
              </ol>
            )}
          </Section>
          <Section name="checks" title="Tests and checks">
            {data.checks.length === 0 ? (
              <Missing>No checks ran.</Missing>
            ) : (
              <>
                <p className="mb-2 text-fg-secondary">
                  {passed} passed, {failed} failed, {notRun} did not run.
                </p>
                <table className="w-full text-left" aria-label="Checks">
                  <thead className="text-xs text-fg-secondary">
                    <tr className="border-b border-line">
                      <th className="py-1 pr-3 font-medium">Check</th>
                      <th className="py-1 pr-3 font-medium">Result</th>
                      <th className="py-1 font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.checks.map((check) => (
                      <tr key={check.id} data-testid="report-check">
                        <td className="py-1.5 pr-3 align-top">
                          {check.label}
                          {check.required && (
                            <Badge className="ml-2" tone="accent">
                              required
                            </Badge>
                          )}
                          <div className="font-mono text-xs text-fg-muted">
                            {check.command}
                          </div>
                        </td>
                        <td className="py-1.5 pr-3 align-top">
                          <Status
                            status={checkStatus(
                              check.status === 'not_run'
                                ? 'skipped'
                                : check.status,
                            )}
                            size="sm"
                            label={
                              check.status === 'not_run' ? 'Not run' : undefined
                            }
                          />
                          {check.summary && (
                            <div className="text-xs text-fg-secondary">
                              {check.summary}
                            </div>
                          )}
                        </td>
                        <td className="py-1.5 align-top text-fg-secondary tabular-nums">
                          {check.durationMs !== null
                            ? formatDuration(check.durationMs)
                            : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </Section>
          <Section name="findings" title="Security findings">
            {data.findings.length === 0 ? (
              <Missing>No findings were raised against this patch.</Missing>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.findings.map((finding) => (
                  <li key={finding.id} data-testid="report-finding">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={severityTone[finding.severity]}>
                        {finding.severity}
                      </Badge>
                      <span className="font-medium">{finding.title}</span>
                      <span className="font-mono text-xs text-fg-secondary">
                        {finding.location.path}
                        {finding.location.line !== null &&
                          `:${finding.location.line}`}
                      </span>
                    </div>
                    {finding.evidence ? (
                      <p className="text-fg-secondary">{finding.evidence}</p>
                    ) : (
                      <Missing>
                        No evidence was recorded by {finding.tool}.
                      </Missing>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section name="unresolved" title="Unresolved issues">
            {data.unresolved.length === 0 ? (
              <Missing>None recorded.</Missing>
            ) : (
              <ul className="list-disc pl-5">
                {data.unresolved.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
          </Section>
          <Section name="outcome" title="Final status">
            <Status status={outcomeStatus[data.outcome]} size="sm" />
          </Section>
        </dl>
      </div>
    </article>
  );
}

function Section({
  name,
  title,
  children,
}: {
  name: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div data-section={name} className="contents">
      <dt className="text-sm font-semibold print:break-after-avoid">{title}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

function Missing({ children }: { children: ReactNode }) {
  return (
    <p className="text-fg-secondary italic" data-testid="report-missing">
      {children}
    </p>
  );
}
