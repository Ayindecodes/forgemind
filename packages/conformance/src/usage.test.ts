import {
  initialRun,
  reduceRun,
  type Event,
  type Run,
  type UsageSummary,
} from '@forgemind/contract';
import { describe, expect, it } from 'vitest';

import type { Ask } from './types';
import { usageAgainstEvents } from './usage';

type Template = Event extends infer E
  ? E extends Event
    ? Omit<E, 'id' | 'runId' | 'seq' | 'at'>
    : never
  : never;

/** A run's events, numbered from one, a second apart from `from`. */
const record = (runId: string, from: string, ...templates: Template[]) =>
  templates.map(
    (template, index) =>
      ({
        id: `${runId}-e${index + 1}`,
        runId,
        seq: index + 1,
        at: new Date(Date.parse(from) + index * 1000).toISOString(),
        ...template,
      }) as Event,
  );

const start: Template = {
  type: 'run.started',
  baseCommit: 'abc1234',
  branch: null,
  expectsPatch: true,
  maxRetries: 2,
};

// The provider and the model are invented for these tests.
const called = (
  inputTokens: number,
  outputTokens: number,
  model = 'model-a',
): Template => ({
  type: 'model.called',
  agent: 'developer',
  provider: 'example',
  model,
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

const end: Template = {
  type: 'run.finished',
  status: 'completed',
  error: null,
};

const runOf = (events: Event[]): Run =>
  events.reduce(reduceRun, initialRun(events[0]!.runId, 'task-1', 'abc1234'));

/** A service that serves these runs, `size` to a page, and their events. */
function serving(records: Event[][], size = 200) {
  const runs = records.map(runOf);
  const asked: string[] = [];
  const ask: Ask = async (key, request = {}) => {
    asked.push(key);
    if (key === 'runs') {
      const from = Number(request.query?.cursor ?? 0);
      const next = from + size;
      return {
        items: runs.slice(from, next),
        nextCursor: next < runs.length ? String(next) : null,
      };
    }
    if (key === 'runEvents') {
      return records.find(([first]) => first?.runId === request.params?.id);
    }
    throw new Error(`nothing here answers ${key}`);
  };
  return { ask, asked };
}

const NOVEMBER = {
  from: '2026-11-01T00:00:00.000Z',
  to: '2026-11-14T12:00:00.000Z',
};

/** A summary of nothing, with whatever a test says was used. */
const summary = (used: Partial<UsageSummary> = {}): UsageSummary => ({
  period: NOVEMBER,
  tokens: [],
  sandboxSeconds: 0,
  cpuSeconds: 0,
  memoryMbHours: 0,
  runs: { total: 0, succeeded: 0, partial: 0, failed: 0, unverified: 0 },
  retryOverheadSeconds: 0,
  storageBytes: 0,
  cost: { kind: 'unavailable', reason: 'No price is set.' },
  quotas: {
    concurrentRuns: { used: 0, max: null },
    monthlyRuns: { used: 0, max: null },
    monthlyTokens: { used: 0, max: null },
  },
  ...used,
});

// Two runs this month. The first called a model twice and was sampled twice:
// 512 MB held for 10 seconds, then 1024 MB for 20 more. The second called it
// once and has not ended.
const first = record(
  'run-1',
  '2026-11-03T09:00:00.000Z',
  start,
  called(1200, 300),
  sampled(3, 512, 10),
  called(800, 150),
  sampled(7.5, 1024, 30),
  end,
);
const second = record(
  'run-2',
  '2026-11-05T09:00:00.000Z',
  start,
  called(50, 5),
);

const used: Partial<UsageSummary> = {
  tokens: [{ provider: 'example', model: 'model-a', input: 2050, output: 455 }],
  sandboxSeconds: 30,
  cpuSeconds: 7.5,
  // 512 × 10 ÷ 3600 and 1024 × 20 ÷ 3600, each to the ten-thousandth.
  memoryMbHours: 1.4222 + 5.6889,
  runs: { total: 2, succeeded: 0, partial: 0, failed: 1, unverified: 0 },
  quotas: {
    concurrentRuns: { used: 1, max: 3 },
    monthlyRuns: { used: 2, max: 200 },
    monthlyTokens: { used: 2505, max: null },
  },
};

const AGREED = { agrees: true, note: 'adds up to the 8 events of 2 runs' };

describe('a usage summary against the events served beside it', () => {
  it('agrees when every figure is what the events add up to', async () => {
    const { ask } = serving([first, second]);
    expect(await usageAgainstEvents(summary(used), ask)).toEqual(AGREED);
  });

  it('agrees about nothing having been used where there are no runs', async () => {
    const { ask } = serving([]);
    expect(await usageAgainstEvents(summary(), ask)).toEqual({
      agrees: true,
      note: 'adds up to the 0 events of 0 runs',
    });
  });

  it.each<[string, Partial<UsageSummary>, string]>([
    [
      'sandbox time',
      { sandboxSeconds: 30.5 },
      'sandboxSeconds is 30 and not 30.5',
    ],
    ['processor time', { cpuSeconds: 7 }, 'cpuSeconds is 7.5 and not 7'],
    [
      'memory',
      { memoryMbHours: 7.1112 },
      'memoryMbHours is 7.1111 and not 7.1112',
    ],
    [
      'time spent retrying',
      { retryOverheadSeconds: 4 },
      'retryOverheadSeconds is 0 and not 4',
    ],
    [
      'tokens written',
      {
        tokens: [
          { provider: 'example', model: 'model-a', input: 2050, output: 456 },
        ],
      },
      'tokens of example/model-a, output is 455 and not 456',
    ],
    [
      'a model no event names',
      {
        tokens: [
          ...used.tokens!,
          { provider: 'example', model: 'model-b', input: 9, output: 0 },
        ],
      },
      'tokens of example/model-b, input is 0 and not 9',
    ],
    [
      'a model left out',
      { tokens: [] },
      'tokens of example/model-a, input is 2050 and not 0; tokens of example/model-a, output is 455 and not 0',
    ],
    [
      'the runs started',
      { runs: { ...used.runs!, total: 3 } },
      'runs.total is 2 and not 3',
    ],
    [
      'how the runs ended',
      { runs: { ...used.runs!, failed: 0, succeeded: 1 } },
      'runs.failed is 1 and not 0; runs.succeeded is 0 and not 1',
    ],
    [
      'the tokens counted against the quota',
      {
        quotas: {
          ...used.quotas!,
          monthlyTokens: { used: 2500, max: null },
        },
      },
      'quotas.monthlyTokens.used is 2505 and not 2500',
    ],
    [
      'the runs counted against the quota',
      {
        quotas: { ...used.quotas!, monthlyRuns: { used: 1, max: 200 } },
      },
      'quotas.monthlyRuns.used is 2 and not 1',
    ],
    [
      'the runs under way',
      {
        quotas: { ...used.quotas!, concurrentRuns: { used: 0, max: 3 } },
      },
      'quotas.concurrentRuns.used is 1 and not 0',
    ],
  ])('says so when %s is not', async (_, wrong, differences) => {
    const { ask } = serving([first, second]);
    expect(
      await usageAgainstEvents(summary({ ...used, ...wrong }), ask),
    ).toEqual({
      agrees: false,
      note: `by the 8 events of 2 runs, ${differences}`,
    });
  });

  it('names the first three figures that differ and counts the rest', async () => {
    const { ask } = serving([first, second]);
    const found = await usageAgainstEvents(summary(), ask);
    expect(found.agrees).toBe(false);
    expect(found.note.split('; ')).toHaveLength(4);
    // Ten figures differ, everything but the time spent retrying.
    expect(found.note).toMatch(/; and 7 more$/);
  });

  it('counts only what happened inside the period the summary gives', async () => {
    const october = record(
      'run-0',
      '2026-10-31T23:59:58.000Z',
      start,
      called(700, 70),
      // The first instant of the period belongs to it.
      called(11, 1),
      called(22, 2),
    );
    const { ask } = serving([october]);
    const within: Partial<UsageSummary> = {
      tokens: [{ provider: 'example', model: 'model-a', input: 33, output: 3 }],
      quotas: {
        ...summary().quotas,
        concurrentRuns: { used: 1, max: null },
        monthlyTokens: { used: 36, max: null },
      },
    };
    // The run began before the period, so it is not one of the period's
    // runs, and what it used inside the period is still the period's.
    expect(await usageAgainstEvents(summary(within), ask)).toEqual({
      agrees: true,
      note: 'adds up to the 4 events of 1 run',
    });
    const everything = await usageAgainstEvents(
      summary({
        ...within,
        tokens: [
          { provider: 'example', model: 'model-a', input: 733, output: 73 },
        ],
      }),
      ask,
    );
    expect(everything.note).toBe(
      'by the 4 events of 1 run, tokens of example/model-a, input is 33 and not 733; tokens of example/model-a, output is 3 and not 73',
    );
    const begun = await usageAgainstEvents(
      summary({ ...within, runs: { ...summary().runs, total: 1 } }),
      ask,
    );
    expect(begun.note).toBe(
      'by the 4 events of 1 run, runs.total is 0 and not 1',
    );
  });

  it('counts an event at the last instant of the period and none after it', async () => {
    const late = record(
      'run-9',
      '2026-11-14T11:59:59.000Z',
      start,
      called(5, 1),
      called(60, 6),
    );
    const { ask } = serving([late]);
    const upTo = (input: number, output: number): UsageSummary =>
      summary({
        tokens: [{ provider: 'example', model: 'model-a', input, output }],
        runs: { ...summary().runs, total: 1 },
        quotas: {
          concurrentRuns: { used: 1, max: null },
          monthlyRuns: { used: 1, max: null },
          monthlyTokens: { used: input + output, max: null },
        },
      });
    expect((await usageAgainstEvents(upTo(5, 1), ask)).agrees).toBe(true);
    expect((await usageAgainstEvents(upTo(65, 7), ask)).agrees).toBe(false);
  });

  it('reads every page of runs', async () => {
    const { ask, asked } = serving([first, second], 1);
    expect(await usageAgainstEvents(summary(used), ask)).toEqual(AGREED);
    expect(asked.filter((key) => key === 'runs')).toHaveLength(2);
    expect(asked.filter((key) => key === 'runEvents')).toHaveLength(2);
  });

  it('does not mind the order the models are listed in', async () => {
    const other = record(
      'run-3',
      '2026-11-06T09:00:00.000Z',
      start,
      called(4, 2, 'model-b'),
    );
    const { ask } = serving([first, other]);
    const rows = [
      { provider: 'example', model: 'model-b', input: 4, output: 2 },
      { provider: 'example', model: 'model-a', input: 2000, output: 450 },
    ];
    const both: Partial<UsageSummary> = {
      ...used,
      quotas: {
        ...used.quotas!,
        monthlyTokens: { used: 2456, max: null },
      },
    };
    for (const tokens of [rows, [...rows].reverse()]) {
      const found = await usageAgainstEvents(summary({ ...both, tokens }), ask);
      expect(found.agrees).toBe(true);
    }
  });
});
