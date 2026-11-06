import type { Event } from '@forgemind/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { timeouts } from '@/lib/motion';

import {
  MAX_ATTEMPTS,
  openEventStream,
  RECONNECT_BACKOFF_MS,
  STALE_AFTER_MS,
  type EventSourceLike,
  type EventStreamOptions,
  type StreamConnection,
} from './event-stream';

class FakeSource implements EventSourceLike {
  static instances: FakeSource[] = [];
  closed = false;
  private listeners = new Map<string, ((m: { data?: string }) => void)[]>();

  constructor(readonly url: string) {
    FakeSource.instances.push(this);
  }
  addEventListener(type: string, listener: (m: { data?: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  fire(type: string, message: { data?: string } = {}) {
    this.listeners.get(type)?.forEach((listener) => listener(message));
  }
  open() {
    this.fire('open');
  }
  send(event: Event) {
    this.fire(event.type, { data: JSON.stringify(event) });
  }
  raw(type: string, data: string) {
    this.fire(type, { data });
  }
  fail() {
    this.fire('error');
  }
}

const log = (seq: number): Event => ({
  id: `event-${seq}`,
  runId: 'run-1',
  seq,
  at: '2026-11-06T12:00:00.000Z',
  type: 'log',
  level: 'info',
  text: `line ${seq}`,
});
const finished = (seq: number): Event => ({
  id: `event-${seq}`,
  runId: 'run-1',
  seq,
  at: '2026-11-06T12:00:00.000Z',
  type: 'run.finished',
  status: 'completed',
  error: null,
});

const latest = () => FakeSource.instances.at(-1)!;
const seqsOf = (batches: Event[][]) => batches.flat().map(({ seq }) => seq);

function start(overrides: Partial<EventStreamOptions> = {}) {
  const batches: Event[][] = [];
  const statuses: StreamConnection['status'][] = [];
  const errors: string[] = [];
  const fetchAfter = vi.fn<(after: number) => Promise<Event[]>>(() =>
    Promise.resolve([]),
  );
  const stream = openEventStream({
    url: (after) => `/runs/run-1/events/stream?after=${after}`,
    fetchAfter,
    onBatch: (events) => batches.push(events),
    onConnection: ({ status }) => statuses.push(status),
    onError: (error) => errors.push(error.message),
    createEventSource: (url) => new FakeSource(url),
    ...overrides,
  });
  return { stream, batches, statuses, errors, fetchAfter };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSource.instances = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe('batching', () => {
  it('delivers a burst as one batch, in order', () => {
    const { batches } = start();
    latest().open();
    for (const seq of [1, 2, 3, 4, 5]) latest().send(log(seq));

    expect(batches).toEqual([]);
    vi.advanceTimersByTime(timeouts.liveBatch);
    expect(batches).toHaveLength(1);
    expect(seqsOf(batches)).toEqual([1, 2, 3, 4, 5]);
  });

  it('flushes the end of a run at once', () => {
    const { batches, statuses, stream } = start();
    latest().open();
    latest().send(log(1));
    latest().send(finished(2));

    expect(seqsOf(batches)).toEqual([1, 2]);
    expect(statuses.at(-1)).toBe('ended');
    expect(stream.connection().status).toBe('ended');
    expect(latest().closed).toBe(true);
  });
});

describe('ordering', () => {
  it('drops duplicates and anything already seen', () => {
    const { batches } = start({ after: 1 });
    latest().open();
    for (const seq of [1, 2, 3, 3, 2, 4]) latest().send(log(seq));
    vi.advanceTimersByTime(timeouts.liveBatch);

    expect(seqsOf(batches)).toEqual([2, 3, 4]);
  });

  it('fills a gap from the REST endpoint and keeps the order', async () => {
    const { batches, fetchAfter } = start();
    fetchAfter.mockResolvedValueOnce([log(4), log(3)]);
    latest().open();
    latest().send(log(1));
    latest().send(log(2));
    latest().send(log(5));
    latest().send(log(6));

    await vi.advanceTimersByTimeAsync(timeouts.liveBatch);

    expect(fetchAfter).toHaveBeenCalledTimes(1);
    expect(fetchAfter).toHaveBeenCalledWith(2);
    expect(seqsOf(batches)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('asks again when the gap is still open', async () => {
    const { batches, fetchAfter } = start();
    fetchAfter.mockResolvedValueOnce([]).mockResolvedValueOnce([log(2)]);
    latest().open();
    latest().send(log(1));
    latest().send(log(3));

    await vi.advanceTimersByTimeAsync(timeouts.liveBatch);
    expect(seqsOf(batches)).toEqual([1]);

    await vi.advanceTimersByTimeAsync(RECONNECT_BACKOFF_MS[0]!);
    await vi.advanceTimersByTimeAsync(timeouts.liveBatch);
    expect(fetchAfter).toHaveBeenCalledTimes(2);
    expect(seqsOf(batches)).toEqual([1, 2, 3]);
  });
});

describe('reconnecting', () => {
  it('resumes after the last sequence seen, with backoff', () => {
    const { statuses, stream } = start();
    latest().open();
    for (const seq of [1, 2, 3]) latest().send(log(seq));
    expect(latest().url).toContain('after=0');

    latest().fail();
    expect(stream.connection().status).toBe('reconnecting');
    expect(FakeSource.instances).toHaveLength(1);

    vi.advanceTimersByTime(RECONNECT_BACKOFF_MS[0]!);
    expect(FakeSource.instances).toHaveLength(2);
    expect(latest().url).toContain('after=3');

    latest().fail();
    vi.advanceTimersByTime(RECONNECT_BACKOFF_MS[0]!);
    expect(FakeSource.instances).toHaveLength(2);
    vi.advanceTimersByTime(RECONNECT_BACKOFF_MS[1]! - RECONNECT_BACKOFF_MS[0]!);
    expect(FakeSource.instances).toHaveLength(3);

    latest().open();
    expect(stream.connection()).toMatchObject({ status: 'live', attempts: 0 });
    expect(statuses).toEqual(['live', 'reconnecting', 'reconnecting', 'live']);
  });

  it('ignores a late message from a connection it already dropped', () => {
    const { batches } = start();
    const first = latest();
    first.open();
    first.send(log(1));
    first.fail();
    vi.advanceTimersByTime(RECONNECT_BACKOFF_MS[0]!);
    first.send(log(2));
    latest().open();
    latest().send(log(2));
    vi.advanceTimersByTime(timeouts.liveBatch);

    expect(seqsOf(batches)).toEqual([1, 2]);
    expect(first.closed).toBe(true);
  });

  it('reconnects when the server goes quiet', () => {
    const { errors, stream } = start();
    latest().open();
    vi.advanceTimersByTime(STALE_AFTER_MS - 1);
    latest().raw('heartbeat', '0');
    vi.advanceTimersByTime(STALE_AFTER_MS - 1);
    expect(stream.connection().status).toBe('live');

    vi.advanceTimersByTime(1);
    expect(stream.connection().status).toBe('reconnecting');
    expect(errors).toEqual(['The stream went quiet']);
  });

  it('does not reconnect once the run has finished', () => {
    const { stream } = start();
    latest().open();
    latest().send(finished(1));
    latest().fail();
    vi.advanceTimersByTime(RECONNECT_BACKOFF_MS.at(-1)!);

    expect(FakeSource.instances).toHaveLength(1);
    expect(stream.connection().status).toBe('ended');
  });

  it('gives up after repeated failures, and retry starts again', () => {
    const { stream } = start();
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      latest().fail();
      expect(stream.connection().status).toBe('reconnecting');
      vi.advanceTimersByTime(RECONNECT_BACKOFF_MS.at(-1)!);
    }
    latest().fail();
    expect(stream.connection().status).toBe('failed');
    const before = FakeSource.instances.length;
    vi.advanceTimersByTime(RECONNECT_BACKOFF_MS.at(-1)! * 2);
    expect(FakeSource.instances).toHaveLength(before);

    stream.retry();
    expect(FakeSource.instances).toHaveLength(before + 1);
    latest().open();
    expect(stream.connection()).toMatchObject({ status: 'live', attempts: 0 });
  });
});

describe('the browser network', () => {
  it('waits while offline and reconnects the moment it is back', () => {
    let handlers: { offline: () => void; online: () => void } | null = null;
    const { batches, stream } = start({
      network: (given) => {
        handlers = given;
        return () => {};
      },
    });
    latest().open();
    latest().send(log(1));
    vi.advanceTimersByTime(timeouts.liveBatch);

    handlers!.offline();
    expect(stream.connection().status).toBe('reconnecting');
    expect(latest().closed).toBe(true);
    vi.advanceTimersByTime(RECONNECT_BACKOFF_MS.at(-1)! * 2);
    expect(FakeSource.instances).toHaveLength(1);

    handlers!.online();
    expect(FakeSource.instances).toHaveLength(2);
    expect(latest().url).toContain('after=1');
    latest().open();
    latest().send(log(2));
    vi.advanceTimersByTime(timeouts.liveBatch);
    expect(stream.connection()).toMatchObject({ status: 'live', attempts: 0 });
    expect(seqsOf(batches)).toEqual([1, 2]);
  });
});

describe('bad input', () => {
  it('reports what it cannot use and carries on', () => {
    const { batches, errors } = start();
    latest().open();
    latest().raw('log', 'not json');
    latest().raw('log', JSON.stringify({ seq: 1, type: 'log' }));
    latest().send(log(1));
    vi.advanceTimersByTime(timeouts.liveBatch);

    expect(errors).toEqual([
      'The stream sent something that is not JSON',
      'The stream sent an event that does not match the contract',
    ]);
    expect(seqsOf(batches)).toEqual([1]);
  });
});

describe('closing', () => {
  it('stops the connection, the timers and anything unsent', () => {
    const { batches, stream } = start();
    latest().open();
    latest().send(log(1));
    stream.close();
    vi.advanceTimersByTime(STALE_AFTER_MS * 2);

    expect(latest().closed).toBe(true);
    expect(batches).toEqual([]);
    expect(FakeSource.instances).toHaveLength(1);
  });
});
