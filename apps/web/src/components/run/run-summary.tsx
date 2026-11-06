'use client';

import type { Event, Run } from '@forgemind/contract';
import type { ReactNode } from 'react';

import { Status } from '@/components/ui/status';
import { formatDuration } from '@/lib/format';
import type { StreamConnection } from '@/lib/live/event-stream';
import { agentLabels } from '@/lib/run-labels';
import { useNow } from '@/lib/use-now';

import { LiveBadge } from './live-badge';
import { runStatus, verificationLabel, verificationStatus } from './run-status';

/** One row that says where the run stands, and what can be done about it. */
export function RunSummary({
  run,
  events,
  connection,
  onRetry,
  actions,
}: {
  run: Run;
  events: readonly Event[];
  connection: StreamConnection;
  onRetry: () => void;
  actions?: ReactNode;
}) {
  // A run waiting for a decision is not working; its clock stops too.
  const endedAt =
    run.finishedAt ??
    (run.status === 'awaiting_approval' ? (events.at(-1)?.at ?? null) : null);
  const running = run.startedAt !== null && endedAt === null;
  const now = useNow(running);
  const elapsed = run.startedAt
    ? Math.max(
        0,
        (endedAt ? Date.parse(endedAt) : now) - Date.parse(run.startedAt),
      )
    : null;
  const { cpuSeconds, memoryPeakMb, sandboxSeconds } = run.resources;
  const hasResources = cpuSeconds > 0 || memoryPeakMb > 0 || sandboxSeconds > 0;

  return (
    <section aria-label="Run summary" className="material-solid">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <LiveBadge connection={connection} onRetry={onRetry} />
        <Status status={runStatus(run)} size="sm" />
        {run.status !== 'queued' && (
          <Status
            status={verificationStatus[run.verification]}
            size="sm"
            label={verificationLabel[run.verification]}
          />
        )}
        <span className="text-sm text-fg-secondary">
          Attempt {run.retries.used + 1} of {run.retries.max + 1}
        </span>
        {elapsed !== null && (
          <span className="text-sm text-fg-secondary tabular-nums">
            {formatDuration(elapsed)}
            {running ? ' so far' : ''}
          </span>
        )}
        {hasResources && (
          <span
            className="text-sm text-fg-muted tabular-nums"
            data-testid="resources"
          >
            CPU {Math.round(cpuSeconds)}s, memory {Math.round(memoryPeakMb)} MB
            peak, sandbox {formatDuration(sandboxSeconds * 1000)}
          </span>
        )}
        <span className="text-sm text-fg-muted tabular-nums">
          {events.length} events
        </span>
        {actions && (
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        )}
      </div>
      <p className="border-t border-line px-4 py-2 text-sm" data-testid="now">
        {run.status === 'running' ? (
          <>
            <span className="font-medium">
              {run.activeAgent ? agentLabels[run.activeAgent] : 'Orchestrator'}
            </span>
            <span className="text-fg-secondary">
              {run.currentOperation
                ? `: ${run.currentOperation}`
                : ' is working'}
            </span>
          </>
        ) : run.status === 'awaiting_approval' ? (
          <span className="text-fg-secondary">
            Waiting for a decision. Nothing runs until someone approves.
          </span>
        ) : run.status === 'queued' ? (
          <span className="text-fg-secondary">
            Queued. Nothing has run yet.
          </span>
        ) : (
          <span className="text-fg-secondary">
            Finished{run.error ? `: ${run.error}` : '.'}
          </span>
        )}
      </p>
    </section>
  );
}
