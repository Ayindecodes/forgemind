import type { Event } from '@forgemind/contract';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';

import type { Store } from './store';

const HEARTBEAT_MS = 15_000;

/**
 * Streams a run's events as server-sent events, catching up from `after`
 * first. Each message id is the event's seq, so a client can resume with
 * Last-Event-ID. The stream ends once the run has finished.
 */
export function streamRunEvents(
  c: Context,
  store: Store,
  orgId: string,
  runId: string,
  after: number,
) {
  return streamSSE(c, async (stream) => {
    const queue: Event[] = [];
    let wake: (() => void) | null = null;
    let closed = false;
    let lastSent = after;

    const push = (event: Event) => {
      queue.push(event);
      wake?.();
    };

    for (const event of store.eventsAfter(orgId, runId, after))
      queue.push(event);
    const unsubscribe = store.subscribe(runId, push);

    stream.onAbort(() => {
      closed = true;
      unsubscribe();
      wake?.();
    });

    try {
      while (!closed) {
        let event = queue.shift();
        while (event) {
          if (event.seq > lastSent) {
            await stream.writeSSE({
              id: String(event.seq),
              event: event.type,
              data: JSON.stringify(event),
            });
            lastSent = event.seq;
            if (event.type === 'run.finished') closed = true;
          }
          event = queue.shift();
        }

        if (closed || store.isFinished(runId)) break;

        const woke = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => {
            wake = null;
            resolve(false);
          }, HEARTBEAT_MS);
          timer.unref?.();
          wake = () => {
            clearTimeout(timer);
            wake = null;
            resolve(true);
          };
        });

        if (!woke && !closed) {
          await stream.writeSSE({ event: 'heartbeat', data: String(lastSent) });
        }
      }
    } finally {
      unsubscribe();
    }
  });
}
