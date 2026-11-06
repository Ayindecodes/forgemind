import { describe, expect, it } from 'vitest';

import type { Event } from './events';
import { initialRun, reduceRun, runFromEvents } from './reduce-run';

let seq = 0;
const at = (offset: number) =>
  new Date(Date.UTC(2026, 10, 2, 0, 0, offset)).toISOString();

type Template = Event extends infer E
  ? E extends Event
    ? Omit<E, 'id' | 'runId' | 'seq' | 'at'>
    : never
  : never;

const ev = (template: Template): Event => {
  seq += 1;
  return {
    id: `e${seq}`,
    runId: 'run',
    seq,
    at: at(seq),
    ...template,
  } as Event;
};

describe('reduceRun', () => {
  it('records every attempt and recomputes the outcome after each event', () => {
    seq = 0;
    const events: Event[] = [
      ev({
        type: 'run.started',
        baseCommit: 'abc',
        branch: 'fix/x',
        expectsPatch: true,
        maxRetries: 1,
      }),
      ev({
        type: 'stage.started',
        stage: 'implementation',
        attempt: 1,
        agent: 'developer',
      }),
      ev({
        type: 'file.changed',
        path: 'src/a.ts',
        change: 'modified',
        additions: 5,
        deletions: 1,
      }),
      ev({
        type: 'stage.finished',
        stage: 'implementation',
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
        checkId: 'tests',
        kind: 'tests',
        label: 'Tests',
        command: 'pnpm test',
        required: true,
      }),
      ev({
        type: 'check.finished',
        checkId: 'tests',
        status: 'failed',
        durationMs: 900,
        summary: '1 failed',
        counts: { passed: 4, failed: 1, skipped: 0 },
      }),
      ev({
        type: 'stage.finished',
        stage: 'testing',
        attempt: 1,
        status: 'failed',
        summary: null,
        failureReason: '1 test failed',
      }),
      ev({
        type: 'retry.scheduled',
        attempt: 2,
        reason: '1 test failed',
        remaining: 0,
      }),
      ev({
        type: 'stage.started',
        stage: 'implementation',
        attempt: 2,
        agent: 'developer',
      }),
      ev({
        type: 'file.changed',
        path: 'src/a.ts',
        change: 'modified',
        additions: 2,
        deletions: 2,
      }),
      ev({
        type: 'stage.finished',
        stage: 'implementation',
        attempt: 2,
        status: 'passed',
        summary: null,
        failureReason: null,
      }),
      ev({
        type: 'stage.started',
        stage: 'testing',
        attempt: 2,
        agent: 'testing',
      }),
      ev({
        type: 'check.started',
        checkId: 'tests',
        kind: 'tests',
        label: 'Tests',
        command: 'pnpm test',
        required: true,
      }),
      ev({
        type: 'check.finished',
        checkId: 'tests',
        status: 'passed',
        durationMs: 900,
        summary: '5 passed',
        counts: { passed: 5, failed: 0, skipped: 0 },
      }),
      ev({
        type: 'stage.finished',
        stage: 'testing',
        attempt: 2,
        status: 'passed',
        summary: null,
        failureReason: null,
      }),
    ];

    const run = runFromEvents('run', 'task', 'abc', events);
    const implementation = run.stages.find(
      (stage) => stage.id === 'implementation',
    );
    const testing = run.stages.find((stage) => stage.id === 'testing');

    expect(
      implementation?.attempts.map(({ number, status }) => [number, status]),
    ).toEqual([
      [1, 'passed'],
      [2, 'passed'],
    ]);
    expect(
      testing?.attempts.map(({ number, status }) => [number, status]),
    ).toEqual([
      [1, 'failed'],
      [2, 'passed'],
    ]);
    expect(run.retries).toEqual({ used: 1, max: 1 });
    expect(run.diff).toEqual({ filesChanged: 1, additions: 2, deletions: 2 });
    expect(run.verification).toBe('pending');
    expect(run.outcome).toBeNull();

    const finished = reduceRun(run, ev({ type: 'approval.requested' }));
    expect(finished.status).toBe('awaiting_approval');
    expect(finished.verification).toBe('verified');
    expect(finished.outcome).toBe('succeeded');
  });

  it('ignores an event it has already folded', () => {
    seq = 0;
    const started = reduceRun(
      initialRun('run', 'task', 'abc'),
      ev({
        type: 'run.started',
        baseCommit: 'abc',
        branch: null,
        expectsPatch: true,
        maxRetries: 0,
      }),
    );
    expect(
      reduceRun(started, { ...ev({ type: 'approval.requested' }), seq: 1 }),
    ).toBe(started);
  });

  it('marks unfinished stages skipped when the run ends', () => {
    seq = 0;
    const run = runFromEvents('run', 'task', 'abc', [
      ev({
        type: 'run.started',
        baseCommit: 'abc',
        branch: null,
        expectsPatch: true,
        maxRetries: 0,
      }),
      ev({
        type: 'stage.started',
        stage: 'inspection',
        attempt: 1,
        agent: 'architect',
      }),
      ev({ type: 'run.finished', status: 'cancelled', error: null }),
    ]);

    expect(run.stages.map(({ status }) => status)).toEqual(
      Array(7).fill('skipped'),
    );
    expect(run.status).toBe('cancelled');
    expect(run.outcome).toBeNull();
  });
});
