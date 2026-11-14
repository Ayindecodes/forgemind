import {
  meterRun,
  runFromEvents,
  totalUsage,
  type Event,
  type Metered,
  type Run,
  type Usage,
} from '@forgemind/contract';

import { scenarios, type ScenarioName } from './scenarios';

/*
 * Each scripted scenario as a full event log, the run state the contract's
 * reducer folds it into, and what the contract measures the run to have
 * used. The real API folds and measures the same logs in Python and must
 * arrive at the same state and the same figures;
 * apps/api/tests/fixtures/runs holds these as JSON.
 */

export type RunFixture = {
  scenario: ScenarioName;
  events: Event[];
  run: Run;
  measures: Metered[];
  usage: Usage;
};

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
  const measures = meterRun(events);
  return {
    scenario: name,
    events,
    run: runFromEvents('run-1', 'task-1', 'abc1234', events),
    measures,
    usage: totalUsage(measures),
  };
}

export const fixtureNames = Object.keys(scenarios) as ScenarioName[];
