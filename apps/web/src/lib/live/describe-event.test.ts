import { Event, EventType } from '@forgemind/contract';
import { describe, expect, it } from 'vitest';

import { describeEvent, eventKind } from './describe-event';

const base = {
  id: 'event-1',
  runId: 'run-1',
  seq: 1,
  at: '2026-11-06T12:00:00.000Z',
};

const samples: Record<EventType, Record<string, unknown>> = {
  'run.started': {
    baseCommit: 'abc1234def',
    branch: 'forgemind/fix',
    expectsPatch: true,
    maxRetries: 2,
  },
  'stage.started': { stage: 'testing', attempt: 2, agent: 'testing' },
  'stage.finished': {
    stage: 'testing',
    attempt: 2,
    status: 'failed',
    summary: '3 tests failed',
    failureReason: 'Budget exhausted',
  },
  'agent.note': { agent: 'developer', text: 'I think the cache is stale.' },
  operation: { agent: 'developer', text: 'Editing src/retry.ts' },
  'file.inspected': { path: 'src/retry.ts' },
  'file.changed': {
    path: 'src/retry.ts',
    change: 'modified',
    additions: 4,
    deletions: 1,
  },
  'command.started': { commandId: 'cmd-1', command: 'pnpm test', cwd: null },
  'command.output': { commandId: 'cmd-1', stream: 'stdout', text: 'ok' },
  'command.finished': { commandId: 'cmd-1', exitCode: 0, durationMs: 1500 },
  'check.started': {
    checkId: 'check-1',
    kind: 'tests',
    label: 'Unit tests',
    command: 'pnpm test',
    required: true,
  },
  'check.finished': {
    checkId: 'check-1',
    status: 'passed',
    durationMs: 1500,
    summary: null,
    counts: { passed: 12, failed: 0, skipped: 1 },
  },
  'retry.scheduled': { attempt: 2, reason: 'Tests failed', remaining: 1 },
  'review.finished': {
    verdict: 'request_changes',
    concerns: ['Missing test'],
    acceptanceCriteriaMet: false,
  },
  'resources.sampled': {
    cpuSeconds: 12.4,
    memoryMb: 512.6,
    sandboxSeconds: 40,
  },
  'approval.requested': {},
  'run.finished': { status: 'completed', error: null },
  log: { level: 'info', text: 'Sandbox ready' },
};

describe('describeEvent', () => {
  it.each(EventType.options)('describes %s in one line', (type) => {
    const event = Event.parse({ ...base, type, ...samples[type] });
    const text = describeEvent(event);

    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('\n');
    expect(text).not.toContain('undefined');
  });

  it('says what happened, in words a reviewer can scan', () => {
    const describe = (type: EventType) =>
      describeEvent(Event.parse({ ...base, type, ...samples[type] }));

    expect(describe('run.started')).toBe(
      'Run started from abc1234 on forgemind/fix',
    );
    expect(describe('stage.started')).toBe(
      'Testing started (attempt 2), Testing agent',
    );
    expect(describe('stage.finished')).toBe(
      'Testing failed: 3 tests failed. Budget exhausted',
    );
    expect(describe('file.changed')).toBe('Changed src/retry.ts (+4 −1)');
    expect(describe('check.finished')).toBe(
      'Check passed (12 passed, 0 failed, 1 skipped)',
    );
    expect(describe('retry.scheduled')).toBe(
      'Retry 2 scheduled: Tests failed (1 retry left)',
    );
    expect(describe('review.finished')).toBe(
      'Review requested changes with 1 concern. Acceptance criteria not met',
    );
  });

  it('marks the one AI-authored kind as a note', () => {
    expect(
      eventKind(
        Event.parse({ ...base, type: 'agent.note', ...samples['agent.note'] }),
      ),
    ).toBe('note');
    expect(
      eventKind(
        Event.parse({ ...base, type: 'operation', ...samples.operation }),
      ),
    ).toBe('execution');
    expect(
      eventKind(
        Event.parse({
          ...base,
          type: 'command.output',
          ...samples['command.output'],
        }),
      ),
    ).toBe('output');
  });
});
