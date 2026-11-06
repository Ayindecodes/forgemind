'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { keys, useRun } from '@/lib/queries';

import { createLiveRun, type LiveRun } from './live-run';

const noSubscription = () => () => {};
const nothing = () => null;

/**
 * Follows a run live. Fetches the run once for its identity, then streams
 * every event from the start and folds them in the browser.
 */
export function useLiveRun(runId: string | undefined) {
  const snapshot = useRun(runId);
  const client = useQueryClient();
  const id = snapshot.data?.id;
  const taskId = snapshot.data?.taskId;
  const baseCommit = snapshot.data?.baseCommit;

  const store = useMemo(
    () =>
      id && taskId && baseCommit
        ? createLiveRun({ id, taskId, baseCommit })
        : null,
    [id, taskId, baseCommit],
  );

  useEffect(() => {
    if (!store) return;
    store.start();
    return () => store.close();
  }, [store]);

  const live: LiveRun | null = useSyncExternalStore(
    store?.subscribe ?? noSubscription,
    store?.getSnapshot ?? nothing,
    nothing,
  );

  // Once the run has ended, the task's own record has moved on too.
  const ended = live?.connection.status === 'ended';
  useEffect(() => {
    if (!ended || !taskId) return;
    void client.invalidateQueries({ queryKey: keys.task(taskId) });
    void client.invalidateQueries({ queryKey: keys.tasks });
  }, [ended, taskId, client]);

  return {
    live,
    loading: snapshot.isPending,
    loadError: snapshot.error,
    retry: () => store?.retry(),
  };
}
