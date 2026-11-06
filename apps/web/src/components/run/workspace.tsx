'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo } from 'react';

import { Button } from '@/components/ui/button';

import { SkeletonText } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { deriveRunView } from '@/lib/live/derive';
import { useLiveRun } from '@/lib/live/use-live-run';
import { usePullRequests, useTask } from '@/lib/queries';

import { DetailsTabs } from './details-tabs';
import { OutcomePanel } from './outcome-panel';
import { RunAnnouncer } from './run-announcer';
import { PlanPanel } from './plan-panel';
import { RunSummary } from './run-summary';
import { TaskActions } from './task-actions';
import { Timeline } from './timeline';

/*
 * The live execution workspace. Everything on it comes from the run's
 * events, folded and derived in the browser; the layout puts the timeline
 * beside the details on wide screens and stacks them for monitoring on a
 * phone, outcome first.
 */

export function RunWorkspace({ taskId }: { taskId: string }) {
  const task = useTask(taskId);
  const params = useSearchParams();
  // An older run from the history replays from its stored events.
  const requestedRun = params.get('run');
  const runId = requestedRun ?? task.data?.runId;
  const olderRun =
    requestedRun !== null &&
    task.data !== undefined &&
    requestedRun !== task.data.runId;
  const pullRequests = usePullRequests(task.data?.status === 'completed');
  const { live, loading, loadError, retry } = useLiveRun(runId);
  const view = useMemo(
    () => (live ? deriveRunView(live.events, live.run) : null),
    [live],
  );
  // The task record (status, decision) lags the live run, and the actions
  // key off it: when the run moves, read the task again so the decision
  // controls appear without a reload.
  const runStatus = live?.run.status;
  const refetchTask = task.refetch;
  useEffect(() => {
    if (runStatus) void refetchTask();
  }, [runStatus, refetchTask]);

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
  if (task.isPending || loading || !live || !view || !task.data) {
    return (
      <div className="material-solid p-4" aria-busy="true">
        <SkeletonText lines={6} />
      </div>
    );
  }

  const { run, events, connection, error } = live;
  const pullRequest =
    pullRequests.data?.items.find((pr) => pr.taskId === taskId) ?? null;

  return (
    <div
      data-testid="run-workspace"
      data-connection={connection.status}
      data-last-seq={connection.lastSeq}
      data-event-count={events.length}
      className="flex flex-col gap-4"
    >
      <RunAnnouncer run={run} />
      {olderRun && (
        <p
          role="status"
          data-testid="older-run"
          className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-info-subtle px-4 py-2 text-sm text-info-fg"
        >
          An earlier run of this task, replayed from its recorded events.
          <Button asChild size="sm" variant="secondary">
            <Link href={`/tasks/${taskId}`}>Latest run</Link>
          </Button>
        </p>
      )}
      <RunSummary
        run={run}
        events={events}
        connection={connection}
        onRetry={retry}
        actions={
          olderRun ? undefined : (
            <TaskActions task={task.data} pullRequest={pullRequest} />
          )
        }
      />
      {error && (
        <p
          role="alert"
          className="rounded-md border border-line bg-warning-subtle px-4 py-2 text-sm text-warning-fg"
        >
          {error.message}. The stream recovered on its own.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[auto_auto_1fr]">
        <div className="lg:col-start-2 lg:row-start-1 empty:hidden">
          <OutcomePanel run={run} view={view} />
        </div>
        <div className="lg:col-start-1 lg:row-span-3 lg:row-start-1">
          <Timeline view={view} run={run} />
        </div>
        <div className="lg:col-start-2 lg:row-start-2 empty:hidden">
          <PlanPanel view={view} />
        </div>
        <div className="lg:col-start-2 lg:row-start-3">
          <DetailsTabs key={run.id} view={view} events={events} />
        </div>
      </div>
    </div>
  );
}
