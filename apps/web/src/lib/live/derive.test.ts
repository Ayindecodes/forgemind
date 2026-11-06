import { Event, initialRun, reduceRun, type Run } from '@forgemind/contract';
import { describe, expect, it } from 'vitest';

import { deriveRunView, explainVerification } from './derive';

/* A compact script: a retry after a failed test, then a security step in review. */

let seq = 0;
let clock = Date.parse('2026-11-06T12:00:00Z');
const at = () => new Date((clock += 1000)).toISOString();
const ev = (payload: Record<string, unknown>): Event =>
  Event.parse({ id: `e${++seq}`, runId: 'run-1', seq, at: at(), ...payload });

const script: Event[] = [
  ev({
    type: 'run.started',
    baseCommit: 'abc1234',
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
  ev({ type: 'file.inspected', path: 'src/retry.ts' }),
  ev({
    type: 'command.started',
    commandId: 'c1',
    command: 'rg retry src',
    cwd: null,
  }),
  ev({
    type: 'command.output',
    commandId: 'c1',
    stream: 'stdout',
    text: 'src/retry.ts:41\n',
  }),
  ev({
    type: 'command.finished',
    commandId: 'c1',
    exitCode: 0,
    durationMs: 120,
  }),
  ev({
    type: 'stage.finished',
    stage: 'inspection',
    attempt: 1,
    status: 'passed',
    summary: '1 file',
    failureReason: null,
  }),
  ev({
    type: 'stage.started',
    stage: 'planning',
    attempt: 1,
    agent: 'architect',
  }),
  ev({
    type: 'agent.note',
    agent: 'architect',
    text: 'Plan: fix the budget check.',
  }),
  ev({
    type: 'stage.finished',
    stage: 'planning',
    attempt: 1,
    status: 'passed',
    summary: '1 file to change',
    failureReason: null,
  }),
  ev({
    type: 'stage.started',
    stage: 'implementation',
    attempt: 1,
    agent: 'developer',
  }),
  ev({
    type: 'file.changed',
    path: 'src/retry.ts',
    change: 'modified',
    additions: 3,
    deletions: 1,
  }),
  ev({
    type: 'stage.finished',
    stage: 'implementation',
    attempt: 1,
    status: 'passed',
    summary: '1 file changed',
    failureReason: null,
  }),
  ev({ type: 'stage.started', stage: 'testing', attempt: 1, agent: 'testing' }),
  ev({
    type: 'check.started',
    checkId: 'tests',
    kind: 'tests',
    label: 'Unit tests',
    command: 'pnpm test',
    required: true,
  }),
  ev({
    type: 'check.finished',
    checkId: 'tests',
    status: 'failed',
    durationMs: 900,
    summary: '1 failed',
    counts: { passed: 3, failed: 1, skipped: 0 },
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
    path: 'src/retry.ts',
    change: 'modified',
    additions: 5,
    deletions: 2,
  }),
  ev({
    type: 'file.changed',
    path: 'tests/retry.test.ts',
    change: 'added',
    additions: 20,
    deletions: 0,
  }),
  ev({
    type: 'stage.finished',
    stage: 'implementation',
    attempt: 2,
    status: 'passed',
    summary: '2 files changed',
    failureReason: null,
  }),
  ev({ type: 'stage.started', stage: 'testing', attempt: 2, agent: 'testing' }),
  ev({
    type: 'check.started',
    checkId: 'tests',
    kind: 'tests',
    label: 'Unit tests',
    command: 'pnpm test',
    required: true,
  }),
  ev({
    type: 'check.finished',
    checkId: 'tests',
    status: 'passed',
    durationMs: 800,
    summary: '4 passed',
    counts: { passed: 4, failed: 0, skipped: 0 },
  }),
  ev({
    type: 'stage.finished',
    stage: 'testing',
    attempt: 2,
    status: 'passed',
    summary: '4 passed',
    failureReason: null,
  }),
  ev({ type: 'stage.started', stage: 'review', attempt: 1, agent: 'review' }),
  ev({ type: 'operation', agent: 'review', text: 'Reading the diff' }),
  ev({ type: 'operation', agent: 'security', text: 'Scanning changed files' }),
  ev({
    type: 'check.started',
    checkId: 'security',
    kind: 'security_scan',
    label: 'Security scan',
    command: 'semgrep',
    required: false,
  }),
  ev({
    type: 'check.finished',
    checkId: 'security',
    status: 'passed',
    durationMs: 300,
    summary: 'No findings',
    counts: null,
  }),
  ev({
    type: 'review.finished',
    verdict: 'approve',
    concerns: [],
    acceptanceCriteriaMet: true,
  }),
  ev({
    type: 'stage.finished',
    stage: 'review',
    attempt: 1,
    status: 'passed',
    summary: 'Approved',
    failureReason: null,
  }),
  ev({ type: 'log', level: 'warn', text: 'Sandbox was slow' }),
];

const fold = (events: Event[]): Run =>
  events.reduce(reduceRun, initialRun('run-1', 'task-1', 'abc1234'));

describe('deriveRunView', () => {
  const run = fold(script);
  const view = deriveRunView(script, run);
  const stage = (id: string) => view.stages.find((stage) => stage.id === id)!;

  it('keeps a failed attempt on the record after a retry', () => {
    expect(
      stage('testing').attempts.map(({ number, status }) => [number, status]),
    ).toEqual([
      [1, 'failed'],
      [2, 'passed'],
    ]);
    expect(stage('testing').attempts[0]?.failureReason).toBe('1 test failed');
    expect(stage('testing').attempts[0]?.checks[0]).toMatchObject({
      status: 'failed',
      counts: { failed: 1 },
    });
    expect(stage('implementation').attempts).toHaveLength(2);
    expect(
      stage('implementation').attempts[0]?.changed.map(({ path }) => path),
    ).toEqual(['src/retry.ts']);
    expect(view.retries.map(({ reason }) => reason)).toEqual(['1 test failed']);
  });

  it('takes the current patch from the latest implementation attempt', () => {
    expect(
      view.changed.map(({ path, additions }) => [path, additions]),
    ).toEqual([
      ['src/retry.ts', 5],
      ['tests/retry.test.ts', 20],
    ]);
    expect(view.inspected).toEqual(['src/retry.ts']);
  });

  it('finds the plan where the architect wrote it', () => {
    expect(view.plan).toMatchObject({
      text: 'Plan: fix the budget check.',
      agent: 'architect',
      summary: '1 file to change',
    });
  });

  it('groups a command with its output and exit', () => {
    expect(view.commands).toHaveLength(1);
    expect(view.commands[0]).toMatchObject({
      command: 'rg retry src',
      stage: 'inspection',
      attempt: 1,
      exitCode: 0,
      durationMs: 120,
      output: [{ stream: 'stdout', text: 'src/retry.ts:41\n' }],
    });
    expect(stage('inspection').attempts[0]?.commands).toHaveLength(1);
  });

  it('labels security as a step inside review, only when it happened', () => {
    const review = stage('review').attempts[0]!;
    expect(review.security).toMatchObject({
      status: 'passed',
      operations: ['Scanning changed files'],
      check: { label: 'Security scan', status: 'passed' },
    });
    expect(review.operations).toEqual([
      'Reading the diff',
      'Scanning changed files',
    ]);

    const withoutSecurity = script.filter(
      (event) =>
        !(
          ('agent' in event && event.agent === 'security') ||
          ('kind' in event && event.kind === 'security_scan') ||
          ('checkId' in event && event.checkId === 'security')
        ),
    );
    const quiet = deriveRunView(withoutSecurity, fold(withoutSecurity));
    expect(
      quiet.stages.find((stage) => stage.id === 'review')?.attempts[0]
        ?.security,
    ).toBeNull();
  });

  it('reports the run checks as they stand after the retry', () => {
    expect(view.checks.map(({ id, status }) => [id, status])).toEqual([
      ['tests', 'passed'],
      ['security', 'passed'],
    ]);
    expect(view.warnings.map(({ text }) => text)).toEqual(['Sandbox was slow']);
  });

  it('marks every stage from the run, even those with no events yet', () => {
    expect(
      view.stages.map(
        ({ id, status, attempts }) => `${id}:${status}:${attempts.length}`,
      ),
    ).toEqual([
      'inspection:passed:1',
      'planning:passed:1',
      'implementation:passed:2',
      'testing:passed:2',
      'review:passed:1',
      'verification:pending:0',
      'approval:pending:0',
    ]);
  });
});

describe('explainVerification', () => {
  it('says why, from the checks alone', () => {
    const run = fold(script);
    expect(run.verification).toBe('pending');
    expect(explainVerification(run)).toMatch(/not finished/);

    const finished = fold([
      ...script,
      ev({
        type: 'stage.started',
        stage: 'verification',
        attempt: 1,
        agent: 'release',
      }),
      ev({
        type: 'check.started',
        checkId: 'build',
        kind: 'build',
        label: 'Build',
        command: 'pnpm build',
        required: true,
      }),
      ev({
        type: 'stage.finished',
        stage: 'verification',
        attempt: 1,
        status: 'failed',
        summary: null,
        failureReason: 'Sandbox died',
      }),
      ev({ type: 'run.finished', status: 'completed', error: 'Sandbox died' }),
    ]);
    expect(finished.verification).toBe('unverified');
    expect(explainVerification(finished)).toBe(
      'Some required checks did not run to a pass: Build (running).',
    );
  });
});
