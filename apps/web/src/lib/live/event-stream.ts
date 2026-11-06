import { Event, EventType } from '@forgemind/contract';

import { timeouts } from '@/lib/motion';

/*
 * The live event layer. Opens a server-sent events stream for one run and
 * hands the UI a clean sequence: events arrive in order, never twice, with
 * any gap filled from the REST endpoint; a dropped connection resumes after
 * the last sequence seen, with backoff; and bursts are delivered in batches
 * so a catch-up of hundreds of events renders once.
 */

export type StreamStatus =
  'connecting' | 'live' | 'reconnecting' | 'ended' | 'failed';

export type StreamConnection = {
  status: StreamStatus;
  /** Consecutive connection attempts that failed. */
  attempts: number;
  /** The last sequence number handed to the UI. */
  lastSeq: number;
  /** When anything, including a heartbeat, last arrived. Epoch milliseconds. */
  lastMessageAt: number | null;
};

/** The part of EventSource this module uses, so tests can stand one in. */
export type EventSourceLike = {
  addEventListener(
    type: string,
    listener: (message: { data?: string }) => void,
  ): void;
  close(): void;
};

export type Timers = {
  set: (callback: () => void, delayMs: number) => unknown;
  clear: (handle: unknown) => void;
};

/** Tells the stream when the browser loses and regains its network. */
export type NetworkEvents = (handlers: {
  offline: () => void;
  online: () => void;
}) => () => void;

export type EventStreamOptions = {
  /** Builds the stream URL that resumes after a sequence number. */
  url: (after: number) => string;
  /** Returns the events after a sequence number, to fill a gap. */
  fetchAfter: (after: number) => Promise<Event[]>;
  onBatch: (events: Event[]) => void;
  onConnection?: (connection: StreamConnection) => void;
  /** Problems the stream recovers from on its own, for the UI to mention. */
  onError?: (error: Error) => void;
  /** Resume after this sequence number. */
  after?: number;
  createEventSource?: (url: string) => EventSourceLike;
  network?: NetworkEvents;
  timers?: Timers;
  now?: () => number;
};

export type EventStream = {
  close(): void;
  /** Starts again after the stream gave up. */
  retry(): void;
  connection(): StreamConnection;
};

/** Waits between reconnection attempts, capped at the last value. */
export const RECONNECT_BACKOFF_MS = [1000, 2000, 4000, 8000, 15_000];
const [REFILL_DELAY_MS = 1000] = RECONNECT_BACKOFF_MS;
/** Consecutive failures before the stream gives up and asks to be retried. */
export const MAX_ATTEMPTS = 8;
/** The server sends a heartbeat every 15 s. Longer than that means trouble. */
export const STALE_AFTER_MS = 35_000;

const defaultNetwork: NetworkEvents = ({ offline, online }) => {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('offline', offline);
  window.addEventListener('online', online);
  return () => {
    window.removeEventListener('offline', offline);
    window.removeEventListener('online', online);
  };
};

const defaultTimers: Timers = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function openEventStream(options: EventStreamOptions): EventStream {
  const timers = options.timers ?? defaultTimers;
  const now = options.now ?? Date.now;
  const createEventSource =
    options.createEventSource ??
    ((url: string) => new EventSource(url, { withCredentials: true }));

  let source: EventSourceLike | null = null;
  let status: StreamStatus = 'connecting';
  let attempts = 0;
  let lastSeq = options.after ?? 0;
  let lastMessageAt: number | null = null;
  let closed = false;
  let finished = false;
  let filling = false;
  let offline = false;

  const batch: Event[] = [];
  /** Events that arrived before the ones they follow. */
  const ahead = new Map<number, Event>();
  let flushHandle: unknown = null;
  let reconnectHandle: unknown = null;
  let staleHandle: unknown = null;
  let refillHandle: unknown = null;

  const connection = (): StreamConnection => ({
    status,
    attempts,
    lastSeq,
    lastMessageAt,
  });
  const setStatus = (next: StreamStatus) => {
    status = next;
    options.onConnection?.(connection());
  };

  /* Batching */

  const flush = () => {
    if (flushHandle !== null) timers.clear(flushHandle);
    flushHandle = null;
    if (batch.length === 0) return;
    options.onBatch(batch.splice(0));
  };
  const scheduleFlush = () => {
    if (flushHandle === null)
      flushHandle = timers.set(flush, timeouts.liveBatch);
  };

  /* Ordering */

  const push = (event: Event) => {
    lastSeq = event.seq;
    batch.push(event);
    if (event.type === 'run.finished') {
      finished = true;
      flush();
      end();
    } else {
      scheduleFlush();
    }
  };

  const accept = (event: Event) => {
    if (closed || event.seq <= lastSeq) return;
    if (event.seq !== lastSeq + 1) {
      ahead.set(event.seq, event);
      void fill();
      return;
    }
    push(event);
    for (;;) {
      const next = ahead.get(lastSeq + 1);
      if (!next) break;
      ahead.delete(next.seq);
      push(next);
    }
  };

  const fill = async () => {
    if (filling || closed) return;
    filling = true;
    try {
      const events = await options.fetchAfter(lastSeq);
      for (const event of [...events].sort((a, b) => a.seq - b.seq))
        accept(event);
    } catch (error) {
      options.onError?.(
        error instanceof Error ? error : new Error('Could not fill the gap'),
      );
    } finally {
      filling = false;
    }
    // Still behind, so the gap is not closed yet. Ask again after a pause.
    if (!closed && ahead.size > 0 && refillHandle === null) {
      refillHandle = timers.set(() => {
        refillHandle = null;
        void fill();
      }, REFILL_DELAY_MS);
    }
  };

  const receive = (data: string | undefined) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data ?? '');
    } catch {
      options.onError?.(
        new Error('The stream sent something that is not JSON'),
      );
      return;
    }
    const result = Event.safeParse(parsed);
    if (!result.success) {
      options.onError?.(
        new Error('The stream sent an event that does not match the contract'),
      );
      return;
    }
    accept(result.data);
  };

  /* Connections */

  const armStale = () => {
    if (staleHandle !== null) timers.clear(staleHandle);
    staleHandle = timers.set(() => {
      staleHandle = null;
      options.onError?.(new Error('The stream went quiet'));
      dropped();
    }, STALE_AFTER_MS);
  };

  const touch = () => {
    lastMessageAt = now();
    armStale();
  };

  const disconnect = () => {
    source?.close();
    source = null;
    if (staleHandle !== null) timers.clear(staleHandle);
    staleHandle = null;
  };

  const end = () => {
    disconnect();
    setStatus('ended');
  };

  const connect = () => {
    if (closed || finished || offline) return;
    const next = createEventSource(options.url(lastSeq));
    source = next;
    const mine = (listener: (message: { data?: string }) => void) => {
      return (message: { data?: string }) => {
        if (next === source) listener(message);
      };
    };

    next.addEventListener(
      'open',
      mine(() => {
        attempts = 0;
        touch();
        setStatus('live');
      }),
    );
    for (const type of EventType.options) {
      next.addEventListener(
        type,
        mine((message) => {
          touch();
          receive(message.data);
        }),
      );
    }
    next.addEventListener(
      'heartbeat',
      mine(() => {
        touch();
        options.onConnection?.(connection());
      }),
    );
    next.addEventListener(
      'error',
      mine(() => dropped()),
    );
    armStale();
  };

  const dropped = () => {
    disconnect();
    if (closed) return;
    if (finished) {
      end();
      return;
    }
    attempts += 1;
    if (attempts > MAX_ATTEMPTS) {
      setStatus('failed');
      return;
    }
    setStatus('reconnecting');
    const delay =
      RECONNECT_BACKOFF_MS[
        Math.min(attempts, RECONNECT_BACKOFF_MS.length) - 1
      ] ?? 0;
    reconnectHandle = timers.set(() => {
      reconnectHandle = null;
      connect();
    }, delay);
  };

  // Without a network there is no point in trying. The moment it is back,
  // reconnect at once rather than waiting out a backoff.
  const unsubscribeNetwork = (options.network ?? defaultNetwork)({
    offline() {
      if (closed || finished) return;
      offline = true;
      disconnect();
      if (reconnectHandle !== null) timers.clear(reconnectHandle);
      reconnectHandle = null;
      setStatus('reconnecting');
    },
    online() {
      if (!offline) return;
      offline = false;
      if (closed || finished || source) return;
      attempts = 0;
      setStatus('reconnecting');
      connect();
    },
  });

  connect();

  return {
    connection,
    retry() {
      if (closed || status !== 'failed') return;
      attempts = 0;
      setStatus('reconnecting');
      connect();
    },
    close() {
      closed = true;
      unsubscribeNetwork();
      disconnect();
      for (const handle of [flushHandle, reconnectHandle, refillHandle]) {
        if (handle !== null) timers.clear(handle);
      }
      flushHandle = reconnectHandle = refillHandle = null;
      batch.length = 0;
      ahead.clear();
    },
  };
}
