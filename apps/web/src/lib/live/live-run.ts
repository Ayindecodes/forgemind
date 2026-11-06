import {
  initialRun,
  reduceRun,
  type Event,
  type Run,
} from '@forgemind/contract';

import { request, urlFor } from '@/lib/api-client';

import {
  openEventStream,
  type EventStream,
  type StreamConnection,
} from './event-stream';

/*
 * A run as the browser sees it live: the fold of every event received so
 * far, the events themselves, and the state of the connection. The run is
 * recomputed from events with the same reducer the API uses, so nothing is
 * shown that the events do not say.
 */

export type LiveRun = {
  run: Run;
  events: readonly Event[];
  connection: StreamConnection;
  /** The last problem the stream reported. It keeps going regardless. */
  error: Error | null;
};

export type LiveRunStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => LiveRun;
  start: () => void;
  retry: () => void;
  close: () => void;
};

export function createLiveRun(seed: {
  id: string;
  taskId: string;
  baseCommit: string;
}): LiveRunStore {
  let state: LiveRun = {
    run: initialRun(seed.id, seed.taskId, seed.baseCommit),
    events: [],
    connection: {
      status: 'connecting',
      attempts: 0,
      lastSeq: 0,
      lastMessageAt: null,
    },
    error: null,
  };
  const listeners = new Set<() => void>();
  let stream: EventStream | null = null;

  const update = (patch: Partial<LiveRun>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    start() {
      if (stream) return;
      stream = openEventStream({
        url: (after) =>
          urlFor('runEventStream', {
            params: { id: seed.id },
            query: { after },
          }),
        fetchAfter: (after) =>
          request('runEvents', { params: { id: seed.id }, query: { after } }),
        onBatch(events) {
          update({
            run: events.reduce(reduceRun, state.run),
            events: [...state.events, ...events],
            connection: {
              ...state.connection,
              lastSeq: events.at(-1)?.seq ?? state.connection.lastSeq,
            },
          });
        },
        onConnection: (connection) => update({ connection }),
        onError: (error) => update({ error }),
      });
    },
    retry: () => stream?.retry(),
    close() {
      stream?.close();
      stream = null;
    },
  };
}
