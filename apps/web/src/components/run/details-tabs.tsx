'use client';

import type { Event } from '@forgemind/contract';

import { Badge } from '@/components/ui/badge';
import { Status } from '@/components/ui/status';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cx } from '@/lib/cx';
import { formatDuration } from '@/lib/format';
import type { CommandView, RunView } from '@/lib/live/derive';
import { stageLabels } from '@/lib/run-labels';

import { EventList } from './event-list';
import { checkStatus } from './timeline';

const OUTPUT_LINES = 40;

const changes = {
  added: 'added',
  modified: 'modified',
  deleted: 'deleted',
  renamed: 'renamed',
} as const;

const kinds = {
  tests: 'Tests',
  build: 'Build',
  lint: 'Lint',
  typecheck: 'Types',
  security_scan: 'Security',
} as const;

export function DetailsTabs({
  view,
  events,
}: {
  view: RunView;
  events: readonly Event[];
}) {
  return (
    <Tabs defaultValue="files" className="material-solid" data-testid="details">
      <TabsList aria-label="Run details" className="border-b border-line px-2">
        <TabsTrigger value="files">
          Files{view.changed.length > 0 ? ` (${view.changed.length})` : ''}
        </TabsTrigger>
        <TabsTrigger value="commands">
          Commands{view.commands.length > 0 ? ` (${view.commands.length})` : ''}
        </TabsTrigger>
        <TabsTrigger value="checks">
          Checks{view.checks.length > 0 ? ` (${view.checks.length})` : ''}
        </TabsTrigger>
        <TabsTrigger value="events">Events ({events.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="files" className="text-sm">
        <Files view={view} />
      </TabsContent>
      <TabsContent value="commands" className="text-sm">
        <Commands commands={view.commands} />
      </TabsContent>
      <TabsContent value="checks" className="text-sm">
        <Checks view={view} />
      </TabsContent>
      <TabsContent value="events">
        <EventList events={events} />
      </TabsContent>
    </Tabs>
  );
}

function Files({ view }: { view: RunView }) {
  if (view.changed.length === 0 && view.inspected.length === 0) {
    return <Empty>No files have been read or changed yet.</Empty>;
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      {view.changed.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-medium text-fg-secondary uppercase">
            Changed in the current patch
          </h3>
          <ul aria-label="Changed files" className="flex flex-col gap-1">
            {view.changed.map((file, index) => (
              <li
                key={index}
                className="flex flex-wrap items-center gap-x-3 gap-y-0.5"
              >
                <span className="font-mono text-xs break-all">{file.path}</span>
                <Badge>{changes[file.change]}</Badge>
                <span className="text-xs tabular-nums">
                  <span className="text-success-fg">+{file.additions}</span>{' '}
                  <span className="text-error-fg">−{file.deletions}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {view.inspected.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-medium text-fg-secondary uppercase">
            Inspected
          </h3>
          <ul aria-label="Inspected files" className="flex flex-col gap-0.5">
            {view.inspected.map((path) => (
              <li key={path} className="font-mono text-xs break-all">
                {path}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Commands({ commands }: { commands: CommandView[] }) {
  if (commands.length === 0) return <Empty>No commands have run yet.</Empty>;

  return (
    <ul aria-label="Commands" className="divide-y divide-line">
      {commands.map((command) => {
        const lines = command.output
          .map(({ text }) => text)
          .join('')
          .replace(/\n$/, '')
          .split('\n');
        const shown = lines.slice(-OUTPUT_LINES);

        return (
          <li key={command.id} data-testid="command">
            <details className="group">
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 select-none">
                <Status
                  status={
                    command.exitCode === null
                      ? 'running'
                      : command.exitCode === 0
                        ? 'passed'
                        : 'failed'
                  }
                  size="sm"
                  iconOnly
                  label={
                    command.exitCode === null
                      ? 'Running'
                      : `Exit ${command.exitCode}`
                  }
                />
                <code className="font-mono text-xs break-all">
                  $ {command.command}
                </code>
                <span className="text-xs text-fg-muted">
                  {stageLabels[command.stage]}
                  {command.attempt > 1 ? `, attempt ${command.attempt}` : ''}
                </span>
                {command.durationMs !== null && (
                  <span className="text-xs text-fg-muted tabular-nums">
                    {formatDuration(command.durationMs)}
                  </span>
                )}
                {command.exitCode !== null && command.exitCode !== 0 && (
                  <Badge tone="error">exit {command.exitCode}</Badge>
                )}
              </summary>
              <div className="px-4 pb-3">
                {command.output.length === 0 ? (
                  <p className="text-xs text-fg-muted">No output.</p>
                ) : (
                  <>
                    <pre className="overflow-x-auto rounded-md bg-canvas p-3 font-mono text-xs text-code-foreground whitespace-pre-wrap">
                      {shown.join('\n')}
                    </pre>
                    {lines.length > OUTPUT_LINES && (
                      <p className="mt-1 text-xs text-fg-muted">
                        Showing the last {OUTPUT_LINES} of {lines.length} lines.
                      </p>
                    )}
                  </>
                )}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

function Checks({ view }: { view: RunView }) {
  if (view.checks.length === 0) {
    return (
      <Empty>
        No checks have run in this attempt.
        {view.retries.length > 0 && ' A retry starts the checks over.'}
      </Empty>
    );
  }

  return (
    <table className="w-full text-left" aria-label="Checks">
      <thead className="text-xs text-fg-secondary">
        <tr className="border-b border-line">
          <th className="px-4 py-2 font-medium">Check</th>
          <th className="px-2 py-2 font-medium">Kind</th>
          <th className="px-2 py-2 font-medium">Result</th>
          <th className="px-2 py-2 font-medium">Time</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {view.checks.map((check) => (
          <tr key={check.id} data-testid="check" data-status={check.status}>
            <td className="px-4 py-2 align-top">
              <div className="font-medium">{check.label}</div>
              <code className="font-mono text-xs text-fg-muted">
                {check.command}
              </code>
              {check.required && (
                <Badge className="ml-2" tone="accent">
                  required
                </Badge>
              )}
            </td>
            <td className="px-2 py-2 align-top text-fg-secondary">
              {kinds[check.kind]}
            </td>
            <td className="px-2 py-2 align-top">
              <Status
                status={checkStatus(check.status)}
                size="sm"
                label={
                  check.status === 'skipped' && !check.finishedAt
                    ? 'Not run'
                    : check.status === 'error'
                      ? 'Error'
                      : undefined
                }
              />
              {check.counts && (
                <div className="text-xs text-fg-secondary tabular-nums">
                  {check.counts.passed} passed, {check.counts.failed} failed,{' '}
                  {check.counts.skipped} skipped
                </div>
              )}
              {check.summary && (
                <div className="text-xs text-fg-secondary">{check.summary}</div>
              )}
            </td>
            <td
              className={cx(
                'px-2 py-2 align-top text-fg-secondary tabular-nums',
              )}
            >
              {check.durationMs !== null
                ? formatDuration(check.durationMs)
                : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 py-6 text-center text-sm text-fg-secondary">
      {children}
    </p>
  );
}
