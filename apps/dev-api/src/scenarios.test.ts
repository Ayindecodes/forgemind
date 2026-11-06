import {
  Event,
  Run,
  runFromEvents,
  type Event as EventType,
} from '@forgemind/contract';
import { describe, expect, it } from 'vitest';

import { scenarios, type ScenarioName } from './scenarios';

const ctx = {
  baseCommit: 'c0ffee1',
  branch: 'forgemind/task-1',
  maxRetries: 2,
};

function eventsOf(name: ScenarioName): EventType[] {
  return scenarios[name](ctx).map(({ at, event }, index) =>
    Event.parse({
      id: `e-${index + 1}`,
      runId: 'run-1',
      seq: index + 1,
      at: new Date(Date.UTC(2026, 10, 2) + at).toISOString(),
      ...event,
    }),
  );
}

const expected: Record<ScenarioName, { outcome: string; status: string }> = {
  happy: { outcome: 'succeeded', status: 'awaiting_approval' },
  'retry-then-unverified': {
    outcome: 'unverified',
    status: 'awaiting_approval',
  },
  partial: { outcome: 'partial', status: 'awaiting_approval' },
  failed: { outcome: 'failed', status: 'completed' },
  investigation: { outcome: 'succeeded', status: 'completed' },
};

describe.each(Object.keys(scenarios) as ScenarioName[])(
  'scenario %s',
  (name) => {
    it('keeps the run valid after every event and ends as expected', () => {
      const events = eventsOf(name);
      let run = runFromEvents('run-1', 'task-1', ctx.baseCommit, []);

      for (const event of events) {
        run = runFromEvents(
          'run-1',
          'task-1',
          ctx.baseCommit,
          events.slice(0, event.seq),
        );
        const result = Run.safeParse(run);
        expect(
          result.success ? [] : result.error.issues,
          `after ${event.type} #${event.seq}`,
        ).toEqual([]);
      }

      expect({ outcome: run.outcome, status: run.status }).toEqual(
        expected[name],
      );
      expect(events.map(({ seq }) => seq)).toEqual(
        events.map((_, index) => index + 1),
      );
    });
  },
);

describe('the retry-then-unverified scenario', () => {
  const events = eventsOf('retry-then-unverified');
  const run = runFromEvents('run-1', 'task-1', ctx.baseCommit, events);

  it('retries once, records the failed check, and ends unverified', () => {
    expect(events.some((event) => event.type === 'retry.scheduled')).toBe(true);
    expect(
      events.some(
        (event) => event.type === 'check.finished' && event.status === 'failed',
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) => event.type === 'check.finished' && event.status === 'error',
      ),
    ).toBe(true);

    const implementation = run.stages.find(({ id }) => id === 'implementation');
    const testing = run.stages.find(({ id }) => id === 'testing');
    expect(implementation?.attempts.map(({ number }) => number)).toEqual([
      1, 2,
    ]);
    expect(testing?.attempts.map(({ status }) => status)).toEqual([
      'failed',
      'passed',
    ]);
    expect(run.retries).toEqual({ used: 1, max: 2 });
    expect(run.verification).toBe('unverified');
    expect(run.outcome).toBe('unverified');
    expect(run.diff?.filesChanged).toBe(3);
  });
});
