import {
  inPeriod,
  meterRun,
  totalUsage,
  type Event,
  type Metered,
  type Run,
  type UsageSummary,
} from '@forgemind/contract';

import type { Ask, Held } from './types';

/*
 * A usage summary says what the organization's runs used. The same service
 * serves those runs and their events, so the summary can be worked out again
 * from outside, by the contract's own rules for measuring an event, and held
 * against what the service answered. The cost and the storage are the
 * service's own business and are not checked here.
 */

type Page<T> = { items: T[]; nextCursor: string | null };

/** Every run the session can see, however many pages that takes. */
async function everyRun(ask: Ask): Promise<Run[]> {
  const runs: Run[] = [];
  let cursor: string | null = null;
  do {
    const page = (await ask('runs', {
      query: { limit: '200', ...(cursor ? { cursor } : {}) },
    })) as Page<Run>;
    runs.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return runs;
}

const counted = (count: number, what: string) =>
  `${count} ${what}${count === 1 ? '' : 's'}`;

/** In ten-thousandths, as usage is measured, so that sums compare exactly. */
const units = (quantity: number) => Math.round(quantity * 10_000);

/** The figures of a summary that its runs and events account for. */
function figures(
  usage: Pick<
    UsageSummary,
    | 'tokens'
    | 'sandboxSeconds'
    | 'cpuSeconds'
    | 'memoryMbHours'
    | 'retryOverheadSeconds'
    | 'runs'
  > & {
    quotas: Record<
      'concurrentRuns' | 'monthlyRuns' | 'monthlyTokens',
      { used: number }
    >;
  },
): Record<string, number> {
  const found: Record<string, number> = {
    sandboxSeconds: units(usage.sandboxSeconds),
    cpuSeconds: units(usage.cpuSeconds),
    memoryMbHours: units(usage.memoryMbHours),
    retryOverheadSeconds: units(usage.retryOverheadSeconds),
    'quotas.concurrentRuns.used': units(usage.quotas.concurrentRuns.used),
    'quotas.monthlyRuns.used': units(usage.quotas.monthlyRuns.used),
    'quotas.monthlyTokens.used': units(usage.quotas.monthlyTokens.used),
  };
  for (const [outcome, count] of Object.entries(usage.runs)) {
    found[`runs.${outcome}`] = units(count);
  }
  for (const row of usage.tokens) {
    const model = `tokens of ${row.provider}/${row.model}`;
    found[`${model}, input`] =
      (found[`${model}, input`] ?? 0) + units(row.input);
    found[`${model}, output`] =
      (found[`${model}, output`] ?? 0) + units(row.output);
  }
  return found;
}

/**
 * Whether `usage` is what the runs and events served beside it add up to
 * over its own period, and the figures where it is not.
 */
export async function usageAgainstEvents(
  usage: UsageSummary,
  ask: Ask,
): Promise<Held> {
  const runs = await everyRun(ask);
  const measures: Metered[] = [];
  let read = 0;
  for (const run of runs) {
    const events = (await ask('runEvents', {
      params: { id: run.id },
      query: { after: '0' },
    })) as Event[];
    read += events.length;
    measures.push(
      ...meterRun(events).filter(({ at }) => inPeriod(at, usage.period)),
    );
  }

  const measured = totalUsage(measures);
  const started = runs.filter(
    ({ startedAt }) => startedAt !== null && inPeriod(startedAt, usage.period),
  );
  const ended = (outcome: Run['outcome']) =>
    started.filter((run) => run.outcome === outcome).length;
  const expected = figures({
    ...measured,
    runs: {
      total: started.length,
      succeeded: ended('succeeded'),
      partial: ended('partial'),
      failed: ended('failed'),
      unverified: ended('unverified'),
    },
    quotas: {
      concurrentRuns: {
        used: runs.filter((run) => run.status === 'running').length,
      },
      monthlyRuns: { used: started.length },
      monthlyTokens: {
        used: measured.tokens.reduce(
          (sum, { input, output }) => sum + input + output,
          0,
        ),
      },
    },
  });
  const said = figures(usage);

  const from = `the ${counted(read, 'event')} of ${counted(runs.length, 'run')}`;
  const differences = [
    ...new Set([...Object.keys(expected), ...Object.keys(said)]),
  ]
    .sort()
    .filter((name) => (expected[name] ?? 0) !== (said[name] ?? 0))
    .map(
      (name) =>
        `${name} is ${(expected[name] ?? 0) / 10_000} and not ${(said[name] ?? 0) / 10_000}`,
    );
  if (differences.length === 0) {
    return { agrees: true, note: `adds up to ${from}` };
  }
  const more = differences.length - 3;
  return {
    agrees: false,
    note: `by ${from}, ${differences.slice(0, 3).join('; ')}${more > 0 ? `; and ${more} more` : ''}`,
  };
}
