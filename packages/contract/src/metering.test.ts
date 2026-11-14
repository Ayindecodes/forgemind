import { describe, expect, it } from 'vitest';

import type { Event } from './events';
import {
  inPeriod,
  measureEvent,
  meterRun,
  totalUsage,
  type Measure,
} from './metering';
import { initialRun, reduceRun } from './reduce-run';

type Template = Event extends infer E
  ? E extends Event
    ? Omit<E, 'id' | 'runId' | 'seq' | 'at'>
    : never
  : never;

/** Events numbered from one, a second apart unless they say when. */
const log = (...templates: (Template & { at?: string })[]): Event[] =>
  templates.map(
    (template, index) =>
      ({
        id: `e${index + 1}`,
        runId: 'run-1',
        seq: index + 1,
        at: new Date(Date.UTC(2026, 10, 2, 0, 0, index)).toISOString(),
        ...template,
      }) as Event,
  );

const start: Template = {
  type: 'run.started',
  baseCommit: 'abc',
  branch: 'fix/x',
  expectsPatch: true,
  maxRetries: 2,
};

const called = (inputTokens: number, outputTokens: number): Template => ({
  type: 'model.called',
  agent: 'developer',
  provider: 'anthropic',
  model: 'model-a',
  inputTokens,
  outputTokens,
});

const sampled = (
  cpuSeconds: number,
  memoryMb: number,
  sandboxSeconds: number,
): Template => ({
  type: 'resources.sampled',
  cpuSeconds,
  memoryMb,
  sandboxSeconds,
});

const started = (attempt: number, at?: string) => ({
  type: 'stage.started' as const,
  stage: 'implementation' as const,
  attempt,
  agent: 'developer' as const,
  ...(at ? { at } : {}),
});

const finished = (attempt: number, at?: string) => ({
  type: 'stage.finished' as const,
  stage: 'implementation' as const,
  attempt,
  status: 'failed' as const,
  summary: null,
  failureReason: 'tests failed',
  ...(at ? { at } : {}),
});

const plain = (kind: Measure['kind'], quantity: number): Measure => ({
  kind,
  quantity,
  direction: null,
  provider: null,
  model: null,
});

const quantities = (events: Event[]) =>
  meterRun(events).map(({ seq, kind, direction, quantity }) =>
    [seq, direction ? `${kind}.${direction}` : kind, quantity].join(' '),
  );

describe('measureEvent', () => {
  it('counts the tokens of a model call, in and out, under its model', () => {
    expect(meterRun(log(start, called(1200, 340)))).toEqual([
      {
        kind: 'tokens',
        quantity: 1200,
        direction: 'input',
        provider: 'anthropic',
        model: 'model-a',
        runId: 'run-1',
        seq: 2,
        at: '2026-11-02T00:00:01.000Z',
      },
      {
        kind: 'tokens',
        quantity: 340,
        direction: 'output',
        provider: 'anthropic',
        model: 'model-a',
        runId: 'run-1',
        seq: 2,
        at: '2026-11-02T00:00:01.000Z',
      },
    ]);
  });

  it('leaves out what came to nothing', () => {
    expect(quantities(log(start, called(900, 0), called(0, 0)))).toEqual([
      '2 tokens.input 900',
    ]);
  });

  it('counts what a sample adds to the one before it', () => {
    expect(
      quantities(log(start, sampled(2.1, 310, 9), sampled(5.5, 512, 23))),
    ).toEqual([
      '2 cpu_seconds 2.1',
      '2 sandbox_seconds 9',
      // 310 MB for 9 seconds, then 512 MB for 14.
      '2 memory_mb_hours 0.775',
      '3 cpu_seconds 3.4',
      '3 sandbox_seconds 14',
      '3 memory_mb_hours 1.9911',
    ]);
  });

  it('counts a sample that changed nothing as nothing', () => {
    expect(
      quantities(log(start, sampled(2, 300, 9), sampled(2, 300, 9))),
    ).toEqual([
      '2 cpu_seconds 2',
      '2 sandbox_seconds 9',
      '2 memory_mb_hours 0.75',
    ]);
  });

  it('rounds to a ten-thousandth, a half going up', () => {
    expect(
      quantities(
        log(start, sampled(0.00025, 0, 0.00005), sampled(0.0007, 0, 0.0005)),
      ),
    ).toEqual([
      '2 cpu_seconds 0.0003',
      '2 sandbox_seconds 0.0001',
      '3 cpu_seconds 0.0005',
      '3 sandbox_seconds 0.0005',
    ]);
  });

  it('takes a total that fell to have started again from zero', () => {
    expect(
      quantities(log(start, sampled(8, 400, 30), sampled(1.5, 200, 6))),
    ).toEqual([
      '2 cpu_seconds 8',
      '2 sandbox_seconds 30',
      '2 memory_mb_hours 3.3333',
      '3 cpu_seconds 1.5',
      '3 sandbox_seconds 6',
      '3 memory_mb_hours 0.3333',
    ]);
  });

  it('counts the time of an attempt after the first as retry overhead', () => {
    expect(
      quantities(
        log(
          start,
          started(1, '2026-11-02T00:00:10.000Z'),
          finished(1, '2026-11-02T00:00:40.000Z'),
          started(2, '2026-11-02T00:01:00.000Z'),
          finished(2, '2026-11-02T00:01:48.250Z'),
        ),
      ),
    ).toEqual(['5 retry_overhead_seconds 48.25']);
  });

  it('counts a retry the run ended in the middle of', () => {
    expect(
      quantities(
        log(
          start,
          started(1),
          finished(1),
          started(2, '2026-11-02T00:01:00.000Z'),
          {
            type: 'run.finished',
            status: 'cancelled',
            error: null,
            at: '2026-11-02T00:01:12.500Z',
          },
        ),
      ),
    ).toEqual(['5 retry_overhead_seconds 12.5']);
  });

  it('counts a retried attempt once, when it finishes', () => {
    expect(
      quantities(
        log(
          start,
          started(2, '2026-11-02T00:01:00.000Z'),
          finished(2, '2026-11-02T00:01:30.000Z'),
          {
            type: 'run.finished',
            status: 'completed',
            error: null,
            at: '2026-11-02T00:02:00.000Z',
          },
        ),
      ),
    ).toEqual(['3 retry_overhead_seconds 30']);
  });

  it('reads times to the millisecond and drops anything finer', () => {
    expect(
      quantities(
        log(
          start,
          started(2, '2026-11-02T00:01:00.000900Z'),
          finished(2, '2026-11-02T00:01:01.000100Z'),
        ),
      ),
    ).toEqual(['3 retry_overhead_seconds 1']);
  });

  it('measures nothing in an event the run has already taken in', () => {
    const [first, call] = log(start, called(1200, 340));
    const before = reduceRun(initialRun('run-1', 'task-1', 'abc'), first!);
    expect(measureEvent(before, call!)).toHaveLength(2);
    expect(measureEvent(reduceRun(before, call!), call!)).toEqual([]);
  });

  it('adds up to what the run reports, for totals that only grew', () => {
    const events = log(
      start,
      sampled(0.3, 120, 1.7),
      sampled(2.1, 310, 9),
      sampled(2.1, 310, 9.2),
      sampled(8.9, 512, 37),
    );
    const run = events.reduce(reduceRun, initialRun('run-1', 'task-1', 'abc'));
    const usage = totalUsage(meterRun(events));
    expect(usage.cpuSeconds).toBe(run.resources.cpuSeconds);
    expect(usage.sandboxSeconds).toBe(run.resources.sandboxSeconds);
  });
});

describe('totalUsage', () => {
  it('adds quantities without drifting', () => {
    const usage = totalUsage([
      plain('cpu_seconds', 0.1),
      plain('cpu_seconds', 0.2),
      plain('sandbox_seconds', 1.1),
      plain('sandbox_seconds', 2.2),
      // Floating point makes 0.0040999999999999995 of these, whether they
      // are added as they stand or multiplied up first and not rounded.
      plain('memory_mb_hours', 0.0012),
      plain('memory_mb_hours', 0.0029),
      plain('retry_overhead_seconds', 48.25),
    ]);
    expect(usage).toEqual({
      tokens: [],
      cpuSeconds: 0.3,
      sandboxSeconds: 3.3,
      memoryMbHours: 0.0041,
      retryOverheadSeconds: 48.25,
    });
  });

  it('adds tokens by model, in the order of their names', () => {
    const tokens = (
      model: string,
      direction: 'input' | 'output',
      quantity: number,
    ): Measure => ({
      kind: 'tokens',
      quantity,
      direction,
      provider: 'anthropic',
      model,
    });
    expect(
      totalUsage([
        tokens('model-b', 'input', 500),
        tokens('model-a', 'input', 1200),
        tokens('model-a', 'output', 340),
        tokens('model-a', 'input', 800),
        { ...tokens('model-a', 'input', 7), provider: 'other' },
      ]).tokens,
    ).toEqual([
      { provider: 'anthropic', model: 'model-a', input: 2000, output: 340 },
      { provider: 'anthropic', model: 'model-b', input: 500, output: 0 },
      { provider: 'other', model: 'model-a', input: 7, output: 0 },
    ]);
  });
});

describe('inPeriod', () => {
  const period = {
    from: '2026-11-01T00:00:00.000Z',
    to: '2026-11-14T09:30:00.250Z',
  };

  it('includes both ends', () => {
    expect(inPeriod('2026-11-01T00:00:00Z', period)).toBe(true);
    expect(inPeriod('2026-11-14T09:30:00.250Z', period)).toBe(true);
    expect(inPeriod('2026-10-31T23:59:59.999Z', period)).toBe(false);
    expect(inPeriod('2026-11-14T09:30:00.251Z', period)).toBe(false);
  });

  it('compares to the millisecond', () => {
    expect(inPeriod('2026-11-14T09:30:00.250999Z', period)).toBe(true);
    expect(inPeriod('2026-10-31T23:59:59.999999Z', period)).toBe(false);
  });
});
