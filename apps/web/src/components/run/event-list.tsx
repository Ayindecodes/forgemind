'use client';

import type { Event } from '@forgemind/contract';
import { useEffect, useRef } from 'react';

import { Badge } from '@/components/ui/badge';
import { cx } from '@/lib/cx';
import { describeEvent, eventKind } from '@/lib/live/describe-event';

const SHOWN = 200;

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour12: false });

/** Every event, one line each, following the newest unless scrolled back. */
export function EventList({ events }: { events: readonly Event[] }) {
  const list = useRef<HTMLOListElement>(null);
  const following = useRef(true);
  const shown = events.length > SHOWN ? events.slice(-SHOWN) : events;

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
              className="font-mono text-xs leading-5 text-fg-muted tabular-nums"
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
                  'font-mono break-words whitespace-pre-wrap',
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
