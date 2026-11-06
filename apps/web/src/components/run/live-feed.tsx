'use client';

import type { Event, Run } from '@forgemind/contract';
import { useEffect, useRef, useState } from 'react';

import { LiveBadge } from '@/components/run/live-badge';
import { Badge } from '@/components/ui/badge';
import { SkeletonText } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { Status, type StatusValue } from '@/components/ui/status';
import { cx } from '@/lib/cx';
import { formatDuration } from '@/lib/format';
import { describeEvent, eventKind } from '@/lib/live/describe-event';
import { useLiveRun } from '@/lib/live/use-live-run';
import { useTask } from '@/lib/queries';
import { agentLabels, stageLabels } from '@/lib/run-labels';

/*
 * The run as its events tell it, live. This is the plain view of the event
 * layer; the execution workspace builds on it. Every line is a real event.
 * Agent notes are explanations and are labelled as such.
 */

const SHOWN = 200;

export function runStatus(run: Run): StatusValue {
  switch (run.status) {
    case 'queued':
      return 'pending';
    case 'running':
      return 'running';
    case 'awaiting_approval':
      return 'awaiting';
    case 'cancelled':
      return 'cancelled';
    case 'completed':
      return run.outcome === 'succeeded'
        ? 'passed'
        : run.outcome === 'partial'
          ? 'partial'
          : run.outcome === 'unverified'
            ? 'unverified'
            : 'failed';
  }
}

export function LiveFeed({ taskId }: { taskId: string }) {
  const task = useTask(taskId);
  const { live, loading, loadError, retry } = useLiveRun(task.data?.runId);

  if (task.error || (!task.isPending && !task.data)) return null;
  if (loadError) {
    return (
      <div className="material-solid">
        <ErrorState
          title="Could not load the run"
          description="The task is there, but its run did not come back from the API."
          onRetry={async () => {
            await task.refetch();
          }}
        />
      </div>
    );
  }
  if (task.isPending || loading || !live) {
    return (
      <div className="material-solid p-4" aria-busy="true">
        <SkeletonText lines={5} />
      </div>
    );
  }

  const { run, events, connection, error } = live;

  return (
    <section
      aria-label="Live run"
      data-testid="live-feed"
      data-connection={connection.status}
      data-last-seq={connection.lastSeq}
      data-event-count={events.length}
      className="material-solid flex flex-col"
    >
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3">
        <LiveBadge connection={connection} onRetry={retry} />
        <Status status={runStatus(run)} size="sm" />
        <span className="text-sm text-fg-secondary">
          Attempt {run.retries.used + 1} of {run.retries.max + 1}
        </span>
        <Elapsed
          startedAt={run.startedAt}
          // A run waiting for a decision is not working; its clock stops too.
          endedAt={
            run.finishedAt ??
            (run.status === 'awaiting_approval'
              ? (events.at(-1)?.at ?? null)
              : null)
          }
        />
        <span className="ml-auto text-sm text-fg-muted tabular-nums">
          {events.length} events
        </span>
      </header>

      <ol
        aria-label="Stages"
        className="flex flex-wrap gap-x-5 gap-y-1 border-b border-line px-4 py-2"
      >
        {run.stages.map((stage) => (
          <li key={stage.id}>
            <Status
              status={stage.status}
              size="sm"
              label={`${stageLabels[stage.id]}${
                stage.attempts.length > 1 ? ` ×${stage.attempts.length}` : ''
              }`}
              className={cx(stage.status === 'pending' && 'text-fg-muted')}
            />
          </li>
        ))}
      </ol>

      <p className="border-b border-line px-4 py-2 text-sm" data-testid="now">
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

      {error && (
        <p
          role="alert"
          className="border-b border-line bg-warning-subtle px-4 py-2 text-sm text-warning-fg"
        >
          {error.message}. The stream recovered on its own.
        </p>
      )}

      <EventList events={events} />
    </section>
  );
}

function Elapsed({
  startedAt,
  endedAt,
}: {
  startedAt: string | null;
  endedAt: string | null;
}) {
  const running = startedAt !== null && endedAt === null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  if (!startedAt) return null;
  const end = endedAt ? new Date(endedAt).getTime() : now;
  const elapsed = Math.max(0, end - new Date(startedAt).getTime());

  return (
    <span className="text-sm text-fg-secondary tabular-nums">
      {formatDuration(elapsed)}
      {running ? ' so far' : ''}
    </span>
  );
}

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour12: false });

function EventList({ events }: { events: readonly Event[] }) {
  const list = useRef<HTMLOListElement>(null);
  const following = useRef(true);
  const shown = events.length > SHOWN ? events.slice(-SHOWN) : events;

  // Follow the newest event unless the reader has scrolled up to look back.
  useEffect(() => {
    const element = list.current;
    if (element && following.current) element.scrollTop = element.scrollHeight;
  }, [events.length]);

  if (events.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-sm text-fg-secondary">
        No events yet.
      </p>
    );
  }

  return (
    <ol
      ref={list}
      aria-label="Events"
      // Scrollable, so it must be reachable from the keyboard.
      tabIndex={0}
      className="max-h-96 overflow-y-auto text-sm outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      onScroll={(event) => {
        const { scrollTop, clientHeight, scrollHeight } = event.currentTarget;
        following.current = scrollTop + clientHeight >= scrollHeight - 8;
      }}
    >
      {events.length > SHOWN && (
        <li className="px-4 py-1 text-xs text-fg-muted">
          Showing the last {SHOWN} of {events.length} events
        </li>
      )}
      {shown.map((event) => {
        const kind = eventKind(event);
        return (
          <li
            key={event.seq}
            data-kind={kind}
            data-type={event.type}
            className="grid grid-cols-[5.5rem_1fr] gap-3 border-b border-line/50 px-4 py-1 last:border-b-0"
          >
            <time
              dateTime={event.at}
              className="font-mono text-xs text-fg-muted tabular-nums leading-5"
            >
              {timeOf(event.at)}
            </time>
            {kind === 'note' ? (
              <span className="flex flex-wrap items-baseline gap-2 text-fg-secondary">
                <Badge tone="info">Agent note</Badge>
                <span>{describeEvent(event)}</span>
              </span>
            ) : kind === 'output' ? (
              <span
                className={cx(
                  'font-mono whitespace-pre-wrap break-words',
                  event.type === 'command.output' && event.stream === 'stderr'
                    ? 'text-warning-fg'
                    : 'text-fg-secondary',
                )}
              >
                {describeEvent(event)}
              </span>
            ) : (
              <span
                className={cx(
                  'break-words',
                  (event.type === 'command.started' ||
                    event.type === 'check.started') &&
                    'font-mono',
                  event.type === 'log' &&
                    event.level === 'error' &&
                    'text-error-fg',
                  event.type === 'log' &&
                    event.level === 'warn' &&
                    'text-warning-fg',
                )}
              >
                {describeEvent(event)}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
