import { runFromEvents, type Event, type Run } from '@forgemind/contract';

import { scenarios, type ScenarioName } from './scenarios';

/*
 * Each scripted scenario as a full event log and the run state the contract's
 * reducer folds it into. The real API folds the same logs in Python and must
 * arrive at the same state; apps/api/tests/fixtures/runs holds these as JSON.
 */

export type RunFixture = { scenario: ScenarioName; events: Event[]; run: Run };

const STARTED_AT = Date.parse('2026-11-06T12:00:00.000Z');

export function runFixture(name: ScenarioName): RunFixture {
  const steps = scenarios[name]({
    baseCommit: 'abc1234',
    branch: 'forgemind/task-1',
    maxRetries: 2,
    category: name === 'investigation' ? 'investigate' : 'fix_bug',
  });
  const events = steps.map(
    (step, index) =>
      ({
        id: `run-1-${index + 1}`,
        runId: 'run-1',
        seq: index + 1,
        at: new Date(STARTED_AT + step.at).toISOString(),
        ...step.event,
      }) as Event,
  );
  return {
    scenario: name,
    events,
    run: runFromEvents('run-1', 'task-1', 'abc1234', events),
  };
}

export const fixtureNames = Object.keys(scenarios) as ScenarioName[];
