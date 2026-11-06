'use client';

import type { Event, Run } from '@forgemind/contract';
import { initialRun, reduceRun } from '@forgemind/contract';
import { useEffect, useMemo, useRef, useState } from 'react';

import { DiffView } from '@/components/review/diff-view';
import { FileTree } from '@/components/review/file-tree';
import { DetailsTabs } from '@/components/run/details-tabs';
import { Timeline } from '@/components/run/timeline';
import { Switch } from '@/components/ui/checkbox';
import { deriveRunView } from '@/lib/live/derive';

import { eventFactory, syntheticDiff } from './synthetic';

/* Three things that must stay smooth: a huge diff, a firehose of events, and glass over motion. */

export function DiffDemo() {
  const files = useMemo(() => syntheticDiff(500), []);
  const [selected, setSelected] = useState(files[0]?.path ?? null);
  const file =
    files.find((candidate) => candidate.path === selected) ?? files[0]!;
  return (
    <section
      aria-labelledby="diff-demo-title"
      className="flex flex-col gap-3"
      data-testid="diff-demo"
      data-files={files.length}
    >
      <h2 id="diff-demo-title" className="text-sm font-semibold">
        500-file diff
      </h2>
      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div
          className="material-solid max-h-[28rem] overflow-y-auto py-1"
          data-testid="diff-tree-scroll"
        >
          <FileTree
            files={files}
            selected={file.path}
            commentCounts={{}}
            onSelect={setSelected}
          />
        </div>
        <DiffView
          key={file.path}
          file={file}
          viewType="split"
          selected={null}
          comments={[]}
          composer={null}
          onOpenComposer={() => {}}
          onCloseComposer={() => {}}
          onSaveComment={() => {}}
          onDeleteComment={() => {}}
        />
      </div>
    </section>
  );
}

const RATE = 50;

export function EventsDemo() {
  const [events, setEvents] = useState<Event[]>([]);
  const [run, setRun] = useState<Run>(() =>
    initialRun('run-perf', 'task-perf', 'abc1234'),
  );
  const [streaming, setStreaming] = useState(false);
  const factory = useRef(eventFactory());

  useEffect(() => {
    if (!streaming) return;
    // Fifty a second, in bursts of five every 100ms, the way a stream batches.
    const timer = setInterval(() => {
      const batch = Array.from({ length: RATE / 10 }, () => factory.current());
      setEvents((current) => [...current, ...batch]);
      setRun((current) => batch.reduce(reduceRun, current));
    }, 100);
    return () => clearInterval(timer);
  }, [streaming]);

  const view = useMemo(() => deriveRunView(events, run), [events, run]);

  return (
    <section
      aria-labelledby="events-demo-title"
      className="flex flex-col gap-3"
      data-testid="events-demo"
      data-events={events.length}
    >
      <div className="flex flex-wrap items-center gap-4">
        <h2 id="events-demo-title" className="text-sm font-semibold">
          Fifty events a second
        </h2>
        <Switch
          label="Stream events"
          checked={streaming}
          onCheckedChange={setStreaming}
          data-testid="events-stream"
        />
        <span
          className="text-sm text-fg-secondary tabular-nums"
          data-testid="events-count"
        >
          {events.length.toLocaleString()} events
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Timeline view={view} run={run} />
        <DetailsTabs key="perf" view={view} events={events} />
      </div>
    </section>
  );
}

export function GlassDemo() {
  return (
    <section
      aria-labelledby="glass-demo-title"
      className="flex flex-col gap-3"
      data-testid="glass-demo"
    >
      <h2 id="glass-demo-title" className="text-sm font-semibold">
        Glass over moving content
      </h2>
      <div
        className="material-solid relative h-[28rem] overflow-y-auto"
        data-testid="glass-scroll"
      >
        <div className="relative h-[400rem]">
          {Array.from({ length: 120 }, (_, index) => (
            <div
              key={index}
              aria-hidden="true"
              className="absolute size-40 rounded-full opacity-80"
              style={{
                top: `${index * 3.3}rem`,
                left: `${(index * 37) % 80}%`,
                background: `hsl(${(index * 47) % 360} 70% 55%)`,
              }}
            />
          ))}
          {Array.from({ length: 10 }, (_, index) => (
            <div
              key={`glass-${index}`}
              className="material-popover sticky mx-6 mb-6 rounded-lg p-4 text-sm"
              style={{ top: `${1 + index * 2.75}rem` }}
            >
              Glass layer {index + 1}: stays readable over whatever passes
              beneath.
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
