'use client';

import { useMemo } from 'react';

import { SkeletonText } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { deriveRunView } from '@/lib/live/derive';
import { useLiveRun } from '@/lib/live/use-live-run';
import { usePullRequests, useTask } from '@/lib/queries';

import { DetailsTabs } from './details-tabs';
import { OutcomePanel } from './outcome-panel';
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
  const pullRequests = usePullRequests(task.data?.status === 'completed');
  const { live, loading, loadError, retry } = useLiveRun(task.data?.runId);
  const view = useMemo(
    () => (live ? deriveRunView(live.events, live.run) : null),
    [live],
  );

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
      <RunSummary
        run={run}
        events={events}
        connection={connection}
        onRetry={retry}
        actions={<TaskActions task={task.data} pullRequest={pullRequest} />}
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
          <DetailsTabs view={view} events={events} />
        </div>
      </div>
    </div>
  );
}
