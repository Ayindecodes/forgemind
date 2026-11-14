import type { Event } from './events';
import { initialRun, reduceRun } from './reduce-run';
import type { Run } from './runs';

/*
 * What a run used, read off its events. An event is measured against the
 * run as it stood before it, so each figure is counted once, by the event
 * that carries it: the tokens of a model call, the processor and sandbox
 * time since the sample before, the time a retried attempt took. Every
 * service measures by these rules, which is what lets a usage summary be
 * checked against the events it says it comes from.
 */

export type MeasureKind =
  | 'tokens'
  | 'sandbox_seconds'
  | 'cpu_seconds'
  | 'memory_mb_hours'
  | 'retry_overhead_seconds';

export type Measure = {
  kind: MeasureKind;
  /** More than zero, and no finer than a ten-thousandth. */
  quantity: number;
  /** For tokens: read by the model or written by it. Otherwise null. */
  direction: 'input' | 'output' | null;
  provider: string | null;
  model: string | null;
};

/** A measure and the event it was read off. */
export type Metered = Measure & { runId: string; seq: number; at: string };

export type Usage = {
  tokens: { provider: string; model: string; input: number; output: number }[];
  sandboxSeconds: number;
  cpuSeconds: number;
  memoryMbHours: number;
  retryOverheadSeconds: number;
};

const UNIT = 10_000;

/** A quantity in ten-thousandths, which add up without drifting. */
const units = (quantity: number) => Math.round(quantity * UNIT);

const measure = (
  kind: MeasureKind,
  quantity: number,
  source: Partial<Pick<Measure, 'direction' | 'provider' | 'model'>> = {},
): Measure[] => {
  const counted = units(quantity);
  if (counted <= 0) return [];
  return [
    {
      kind,
      quantity: counted / UNIT,
      direction: null,
      provider: null,
      model: null,
      ...source,
    },
  ];
};

/** Milliseconds since 1970. Anything finer in the timestamp is dropped. */
export const milliseconds = (at: string) =>
  Date.parse(at.replace(/(\.\d{3})\d+/, '$1'));

/**
 * How far a running total moved. One that reads lower than it did has
 * started again from zero, so all of the new reading counts.
 */
const advance = (previous: number, reading: number) =>
  reading >= previous ? reading - previous : reading;

const secondsBetween = (from: string, to: string) =>
  Math.max(0, milliseconds(to) - milliseconds(from)) / 1000;

/** What `event` adds to the usage of `run`, the run before the event. */
export function measureEvent(run: Run, event: Event): Measure[] {
  if (event.seq <= run.lastSeq) return [];

  switch (event.type) {
    case 'model.called': {
      const source = { provider: event.provider, model: event.model };
      return [
        ...measure('tokens', event.inputTokens, {
          ...source,
          direction: 'input',
        }),
        ...measure('tokens', event.outputTokens, {
          ...source,
          direction: 'output',
        }),
      ];
    }

    case 'resources.sampled': {
      const sandbox = advance(
        run.resources.sandboxSeconds,
        event.sandboxSeconds,
      );
      return [
        ...measure(
          'cpu_seconds',
          advance(run.resources.cpuSeconds, event.cpuSeconds),
        ),
        ...measure('sandbox_seconds', sandbox),
        // The memory in use at the sample, held for the time since the last.
        ...measure('memory_mb_hours', (event.memoryMb * sandbox) / 3600),
      ];
    }

    // An attempt after the first is time spent because an earlier one failed.
    case 'stage.finished': {
      if (event.attempt < 2) return [];
      const attempt = run.stages
        .find((stage) => stage.id === event.stage)
        ?.attempts.find(
          ({ number, status }) =>
            number === event.attempt && status === 'running',
        );
      if (!attempt) return [];
      return measure(
        'retry_overhead_seconds',
        secondsBetween(attempt.startedAt, event.at),
      );
    }

    // A run that ends in the middle of a retry spent the time all the same.
    case 'run.finished':
      return measure(
        'retry_overhead_seconds',
        run.stages
          .flatMap((stage) => stage.attempts)
          .filter(({ number, status }) => number >= 2 && status === 'running')
          .reduce(
            (sum, attempt) => sum + secondsBetween(attempt.startedAt, event.at),
            0,
          ),
      );

    case 'run.started':
    case 'stage.started':
    case 'agent.note':
    case 'operation':
    case 'file.inspected':
    case 'file.changed':
    case 'command.started':
    case 'command.output':
    case 'command.finished':
    case 'check.started':
    case 'check.finished':
    case 'retry.scheduled':
    case 'review.finished':
    case 'approval.requested':
    case 'log':
      return [];
  }
}

/** Every measure in one run's events, in order. */
export function meterRun(events: readonly Event[]): Metered[] {
  const first = events[0];
  if (!first) return [];

  let run = initialRun(first.runId, '', '');
  const metered: Metered[] = [];
  for (const event of events) {
    for (const item of measureEvent(run, event)) {
      metered.push({
        ...item,
        runId: event.runId,
        seq: event.seq,
        at: event.at,
      });
    }
    run = reduceRun(run, event);
  }

  return metered;
}

/** Whether a time falls in a period, to the millisecond, ends included. */
export const inPeriod = (at: string, period: { from: string; to: string }) =>
  milliseconds(period.from) <= milliseconds(at) &&
  milliseconds(at) <= milliseconds(period.to);

/** Measures added up, tokens by the model that used them. */
export function totalUsage(measures: Iterable<Measure>): Usage {
  const sums: Record<Exclude<MeasureKind, 'tokens'>, number> = {
    sandbox_seconds: 0,
    cpu_seconds: 0,
    memory_mb_hours: 0,
    retry_overhead_seconds: 0,
  };
  const tokens = new Map<string, Usage['tokens'][number]>();

  for (const item of measures) {
    if (item.kind !== 'tokens') {
      sums[item.kind] += units(item.quantity);
      continue;
    }
    if (!item.provider || !item.model || !item.direction) continue;
    const key = `${item.provider}/${item.model}`;
    const row = tokens.get(key) ?? {
      provider: item.provider,
      model: item.model,
      input: 0,
      output: 0,
    };
    row[item.direction] += item.quantity;
    tokens.set(key, row);
  }

  return {
    tokens: [...tokens.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, row]) => row),
    sandboxSeconds: sums.sandbox_seconds / UNIT,
    cpuSeconds: sums.cpu_seconds / UNIT,
    memoryMbHours: sums.memory_mb_hours / UNIT,
    retryOverheadSeconds: sums.retry_overhead_seconds / UNIT,
  };
}
