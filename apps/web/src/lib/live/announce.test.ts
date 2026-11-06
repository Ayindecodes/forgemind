import { Event, initialRun, reduceRun, type Run } from '@forgemind/contract';
import { describe, expect, it } from 'vitest';

import { announcements } from './announce';

let seq = 0;
const ev = (payload: Record<string, unknown>): Event =>
  Event.parse({
    id: `e${++seq}`,
    runId: 'run-1',
    seq,
    at: '2026-11-06T12:00:00.000Z',
    ...payload,
  });

const step = (run: Run, ...events: Event[]) => events.reduce(reduceRun, run);

describe('announcements', () => {
  it('speaks the run status, stage changes and the verdict, not the chatter', () => {
    const start = initialRun('run-1', 'task-1', 'abc');
    expect(announcements(null, start)).toEqual(['Run queued']);

    const running = step(
      start,
      ev({
        type: 'run.started',
        baseCommit: 'abc',
        branch: null,
        expectsPatch: true,
        maxRetries: 1,
      }),
      ev({
        type: 'stage.started',
        stage: 'inspection',
        attempt: 1,
        agent: 'architect',
      }),
    );
    expect(announcements(start, running)).toEqual([
      'Run started',
      'Inspection running',
    ]);

    const busy = step(
      running,
      ev({ type: 'operation', agent: 'architect', text: 'Reading files' }),
      ev({ type: 'file.inspected', path: 'a.ts' }),
    );
    expect(announcements(running, busy)).toEqual([]);

    const failedTests = step(
      busy,
      ev({
        type: 'stage.finished',
        stage: 'inspection',
        attempt: 1,
        status: 'passed',
        summary: null,
        failureReason: null,
      }),
      ev({
        type: 'stage.started',
        stage: 'testing',
        attempt: 1,
        agent: 'testing',
      }),
      ev({
        type: 'check.started',
        checkId: 't',
        kind: 'tests',
        label: 'Tests',
        command: 'x',
        required: true,
      }),
      ev({
        type: 'check.finished',
        checkId: 't',
        status: 'failed',
        durationMs: 1,
        summary: null,
        counts: null,
      }),
      ev({
        type: 'stage.finished',
        stage: 'testing',
        attempt: 1,
        status: 'failed',
        summary: null,
        failureReason: '1 test failed',
      }),
    );
    expect(announcements(busy, failedTests)).toEqual([
      'Inspection passed',
      'Testing failed: 1 test failed',
      'Verification failed',
    ]);

    // A retry starts the checks over, so the verdict is open again; the retry is spoken.
    const retried = step(
      failedTests,
      ev({
        type: 'retry.scheduled',
        attempt: 2,
        reason: '1 test failed',
        remaining: 0,
      }),
    );
    expect(announcements(failedTests, retried)).toEqual([
      'Retry 1 of 1 scheduled',
    ]);
  });
});
