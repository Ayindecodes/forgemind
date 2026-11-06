import type { Event, TaskCategory } from '@forgemind/contract';

/*
 * Scripted runs. Each scenario is a list of events with the time, in
 * milliseconds, at which they happen. The player turns them into real events
 * with ids, sequence numbers and timestamps. Everything here is invented.
 */

export type EventTemplate = Event extends infer E
  ? E extends Event
    ? Omit<E, 'id' | 'runId' | 'seq' | 'at'>
    : never
  : never;

export type Step = { at: number; event: EventTemplate };

export type ScenarioName =
  'happy' | 'retry-then-unverified' | 'partial' | 'failed' | 'investigation';

export type ScenarioContext = {
  baseCommit: string;
  branch: string;
  maxRetries: number;
};

class Script {
  readonly steps: Step[] = [];
  private clock = 0;

  add(event: EventTemplate, after = 1500) {
    this.clock += after;
    this.steps.push({ at: this.clock, event });
    return this;
  }
}

const sample = (script: Script, cpu: number, memory: number, sandbox: number) =>
  script.add(
    {
      type: 'resources.sampled',
      cpuSeconds: cpu,
      memoryMb: memory,
      sandboxSeconds: sandbox,
    },
    500,
  );

function inspection(script: Script) {
  script
    .add(
      {
        type: 'stage.started',
        stage: 'inspection',
        attempt: 1,
        agent: 'architect',
      },
      800,
    )
    .add(
      {
        type: 'operation',
        agent: 'architect',
        text: 'Reading the repository structure',
      },
      400,
    )
    .add({ type: 'file.inspected', path: 'package.json' }, 900)
    .add({ type: 'file.inspected', path: 'src/retry.ts' }, 1100)
    .add({ type: 'file.inspected', path: 'src/tasks/run.ts' }, 1000)
    .add({ type: 'file.inspected', path: 'tests/retry.test.ts' }, 900)
    .add(
      {
        type: 'command.started',
        commandId: 'cmd-grep',
        command: 'rg "retryBudget" src',
        cwd: null,
      },
      600,
    )
    .add(
      {
        type: 'command.output',
        commandId: 'cmd-grep',
        stream: 'stdout',
        text: 'src/retry.ts:41:  if (retryBudget < 0) return;\nsrc/tasks/run.ts:88:  retryBudget = plan.maxRetries;\n',
      },
      300,
    )
    .add(
      {
        type: 'command.finished',
        commandId: 'cmd-grep',
        exitCode: 0,
        durationMs: 212,
      },
      200,
    )
    .add(
      {
        type: 'agent.note',
        agent: 'architect',
        text: 'The retry budget is reset from the plan on every revision, so a run can retry more times than the task allows. The check at src/retry.ts:41 never fires.',
      },
      2200,
    )
    .add(
      {
        type: 'stage.finished',
        stage: 'inspection',
        attempt: 1,
        status: 'passed',
        summary: '4 files inspected, likely cause at src/retry.ts:41',
        failureReason: null,
      },
      800,
    );
  sample(script, 2.1, 310, 9);
}

function planning(script: Script) {
  script
    .add(
      {
        type: 'stage.started',
        stage: 'planning',
        attempt: 1,
        agent: 'architect',
      },
      700,
    )
    .add(
      {
        type: 'operation',
        agent: 'architect',
        text: 'Drafting the implementation plan',
      },
      400,
    )
    .add(
      {
        type: 'agent.note',
        agent: 'architect',
        text: 'Plan: carry the remaining budget across revisions in src/retry.ts, add a regression test, and keep src/tasks/run.ts untouched apart from the type. Acceptance: the new test passes and the existing 41 tests keep passing.',
      },
      3200,
    )
    .add(
      {
        type: 'stage.finished',
        stage: 'planning',
        attempt: 1,
        status: 'passed',
        summary: '2 files to change, 1 test to add',
        failureReason: null,
      },
      900,
    );
}

function implementation(
  script: Script,
  attempt: number,
  files: EventTemplate[],
) {
  script
    .add(
      {
        type: 'stage.started',
        stage: 'implementation',
        attempt,
        agent: 'developer',
      },
      700,
    )
    .add(
      {
        type: 'operation',
        agent: 'developer',
        text:
          attempt === 1
            ? 'Applying the plan'
            : 'Revising the retry bookkeeping',
      },
      400,
    );
  for (const file of files) script.add(file, 2000);
  script.add(
    {
      type: 'stage.finished',
      stage: 'implementation',
      attempt,
      status: 'passed',
      summary: `${files.length} file${files.length === 1 ? '' : 's'} changed`,
      failureReason: null,
    },
    900,
  );
  sample(script, 2.1 + attempt * 3.4, 512, 9 + attempt * 14);
}

const firstPatch: EventTemplate[] = [
  {
    type: 'file.changed',
    path: 'src/retry.ts',
    change: 'modified',
    additions: 18,
    deletions: 6,
  },
  {
    type: 'file.changed',
    path: 'tests/retry.test.ts',
    change: 'added',
    additions: 42,
    deletions: 0,
  },
  {
    type: 'file.changed',
    path: 'src/types.ts',
    change: 'modified',
    additions: 2,
    deletions: 1,
  },
];

const revisedPatch: EventTemplate[] = [
  {
    type: 'file.changed',
    path: 'src/retry.ts',
    change: 'modified',
    additions: 21,
    deletions: 7,
  },
  {
    type: 'file.changed',
    path: 'tests/retry.test.ts',
    change: 'added',
    additions: 42,
    deletions: 0,
  },
  {
    type: 'file.changed',
    path: 'src/types.ts',
    change: 'modified',
    additions: 2,
    deletions: 1,
  },
];

function testing(script: Script, attempt: number, pass: boolean) {
  const cmd = `cmd-test-${attempt}`;
  script
    .add(
      { type: 'stage.started', stage: 'testing', attempt, agent: 'testing' },
      700,
    )
    .add(
      {
        type: 'check.started',
        checkId: 'tests',
        kind: 'tests',
        label: 'Unit tests',
        command: 'pnpm test',
        required: true,
      },
      500,
    )
    .add(
      {
        type: 'command.started',
        commandId: cmd,
        command: 'pnpm test',
        cwd: null,
      },
      200,
    )
    .add(
      {
        type: 'command.output',
        commandId: cmd,
        stream: 'stdout',
        text: '> vitest run\n\n ✓ tests/tasks.test.ts (12)\n ✓ tests/plan.test.ts (29)\n',
      },
      2600,
    );

  if (pass) {
    script
      .add(
        {
          type: 'command.output',
          commandId: cmd,
          stream: 'stdout',
          text: ' ✓ tests/retry.test.ts (3)\n\n Test Files  3 passed (3)\n      Tests  44 passed (44)\n',
        },
        1800,
      )
      .add(
        {
          type: 'command.finished',
          commandId: cmd,
          exitCode: 0,
          durationMs: 4310,
        },
        200,
      )
      .add(
        {
          type: 'check.finished',
          checkId: 'tests',
          status: 'passed',
          durationMs: 4310,
          summary: '44 passed',
          counts: { passed: 44, failed: 0, skipped: 0 },
        },
        200,
      )
      .add(
        {
          type: 'stage.finished',
          stage: 'testing',
          attempt,
          status: 'passed',
          summary: '44 tests passed',
          failureReason: null,
        },
        600,
      );
  } else {
    script
      .add(
        {
          type: 'command.output',
          commandId: cmd,
          stream: 'stderr',
          text: ' ✗ tests/retry.test.ts > keeps the remaining budget across revisions\n   AssertionError: expected 1 to be 0\n',
        },
        1800,
      )
      .add(
        {
          type: 'command.output',
          commandId: cmd,
          stream: 'stdout',
          text: '\n Test Files  1 failed | 2 passed (3)\n      Tests  1 failed | 43 passed (44)\n',
        },
        300,
      )
      .add(
        {
          type: 'command.finished',
          commandId: cmd,
          exitCode: 1,
          durationMs: 4480,
        },
        200,
      )
      .add(
        {
          type: 'check.finished',
          checkId: 'tests',
          status: 'failed',
          durationMs: 4480,
          summary: '1 failed, 43 passed',
          counts: { passed: 43, failed: 1, skipped: 0 },
        },
        200,
      )
      .add(
        {
          type: 'stage.finished',
          stage: 'testing',
          attempt,
          status: 'failed',
          summary: null,
          failureReason:
            'keeps the remaining budget across revisions: expected 1 to be 0',
        },
        600,
      );
  }
}

function review(
  script: Script,
  verdict: 'approve' | 'request_changes',
  concerns: string[],
) {
  script
    .add(
      { type: 'stage.started', stage: 'review', attempt: 1, agent: 'review' },
      700,
    )
    .add(
      {
        type: 'operation',
        agent: 'review',
        text: 'Reading the patch against the acceptance criteria',
      },
      400,
    )
    .add(
      {
        type: 'operation',
        agent: 'security',
        text: 'Scanning the changed files',
      },
      2400,
    )
    .add(
      {
        type: 'check.started',
        checkId: 'security',
        kind: 'security_scan',
        label: 'Security scan',
        command: 'semgrep --config auto src',
        required: false,
      },
      300,
    )
    .add(
      {
        type: 'check.finished',
        checkId: 'security',
        status: 'passed',
        durationMs: 2900,
        summary: 'No findings in changed files',
        counts: null,
      },
      2900,
    )
    .add(
      {
        type: 'agent.note',
        agent: 'review',
        text:
          verdict === 'approve'
            ? 'The change is limited to the retry bookkeeping and the new test covers the regression. No unrelated edits.'
            : 'The budget is carried across revisions but the failing assertion shows an off-by-one when the budget is exhausted exactly.',
      },
      1200,
    )
    .add(
      {
        type: 'review.finished',
        verdict,
        concerns,
        acceptanceCriteriaMet: verdict === 'approve',
      },
      400,
    )
    .add(
      {
        type: 'stage.finished',
        stage: 'review',
        attempt: 1,
        status: verdict === 'approve' ? 'passed' : 'failed',
        summary:
          verdict === 'approve'
            ? 'Approved, no concerns'
            : `${concerns.length} concern${concerns.length === 1 ? '' : 's'}`,
        failureReason: verdict === 'approve' ? null : (concerns[0] ?? null),
      },
      500,
    );
}

function verification(script: Script, mode: 'pass' | 'sandbox-error') {
  script
    .add(
      {
        type: 'stage.started',
        stage: 'verification',
        attempt: 1,
        agent: 'orchestrator',
      },
      700,
    )
    .add(
      {
        type: 'check.started',
        checkId: 'build',
        kind: 'build',
        label: 'Build',
        command: 'pnpm build',
        required: true,
      },
      400,
    )
    .add(
      {
        type: 'command.started',
        commandId: 'cmd-build',
        command: 'pnpm build',
        cwd: null,
      },
      200,
    );

  if (mode === 'sandbox-error') {
    script
      .add(
        {
          type: 'command.output',
          commandId: 'cmd-build',
          stream: 'stdout',
          text: '> tsc -p tsconfig.build.json\n',
        },
        2000,
      )
      .add(
        {
          type: 'log',
          level: 'error',
          text: 'sandbox: container exceeded 2048 MiB and was killed',
        },
        2600,
      )
      .add(
        {
          type: 'command.finished',
          commandId: 'cmd-build',
          exitCode: 137,
          durationMs: 4600,
        },
        100,
      )
      .add(
        {
          type: 'check.finished',
          checkId: 'build',
          status: 'error',
          durationMs: 4600,
          summary: 'The sandbox ran out of memory before the build finished',
          counts: null,
        },
        200,
      )
      .add(
        {
          type: 'log',
          level: 'warn',
          text: 'Skipping typecheck and lint: the sandbox is gone',
        },
        300,
      )
      .add(
        {
          type: 'stage.finished',
          stage: 'verification',
          attempt: 1,
          status: 'failed',
          summary: null,
          failureReason: 'The build check could not run',
        },
        500,
      );
    return;
  }

  script
    .add(
      {
        type: 'command.output',
        commandId: 'cmd-build',
        stream: 'stdout',
        text: '> tsc -p tsconfig.build.json\n> Build completed in 6.1s\n',
      },
      6100,
    )
    .add(
      {
        type: 'command.finished',
        commandId: 'cmd-build',
        exitCode: 0,
        durationMs: 6100,
      },
      100,
    )
    .add(
      {
        type: 'check.finished',
        checkId: 'build',
        status: 'passed',
        durationMs: 6100,
        summary: 'Build completed',
        counts: null,
      },
      200,
    )
    .add(
      {
        type: 'check.started',
        checkId: 'typecheck',
        kind: 'typecheck',
        label: 'Type check',
        command: 'pnpm typecheck',
        required: true,
      },
      300,
    )
    .add(
      {
        type: 'check.finished',
        checkId: 'typecheck',
        status: 'passed',
        durationMs: 3900,
        summary: 'No type errors',
        counts: null,
      },
      3900,
    )
    .add(
      {
        type: 'check.started',
        checkId: 'lint',
        kind: 'lint',
        label: 'Lint',
        command: 'pnpm lint',
        required: false,
      },
      300,
    )
    .add(
      {
        type: 'check.finished',
        checkId: 'lint',
        status: 'passed',
        durationMs: 2100,
        summary: 'No problems',
        counts: null,
      },
      2100,
    )
    .add(
      {
        type: 'stage.finished',
        stage: 'verification',
        attempt: 1,
        status: 'passed',
        summary: 'Build, type check and lint passed',
        failureReason: null,
      },
      500,
    );
}

function awaitApproval(script: Script) {
  script
    .add(
      {
        type: 'stage.started',
        stage: 'approval',
        attempt: 1,
        agent: 'release',
      },
      600,
    )
    .add(
      {
        type: 'operation',
        agent: 'release',
        text: 'Preparing the change summary for review',
      },
      400,
    )
    .add({ type: 'approval.requested' }, 1800);
}

const start = (script: Script, ctx: ScenarioContext, expectsPatch = true) =>
  script.add(
    {
      type: 'run.started',
      baseCommit: ctx.baseCommit,
      branch: expectsPatch ? ctx.branch : null,
      expectsPatch,
      maxRetries: ctx.maxRetries,
    },
    300,
  );

export const scenarios: Record<ScenarioName, (ctx: ScenarioContext) => Step[]> =
  {
    happy(ctx) {
      const script = new Script();
      start(script, ctx);
      inspection(script);
      planning(script);
      implementation(script, 1, firstPatch);
      testing(script, 1, true);
      review(script, 'approve', []);
      verification(script, 'pass');
      awaitApproval(script);
      return script.steps;
    },

    /** Retries once after a failed test, passes, then the sandbox dies during verification. */
    'retry-then-unverified'(ctx) {
      const script = new Script();
      start(script, { ...ctx, maxRetries: Math.max(1, ctx.maxRetries) });
      inspection(script);
      planning(script);
      implementation(script, 1, firstPatch);
      testing(script, 1, false);
      script.add(
        {
          type: 'retry.scheduled',
          attempt: 2,
          reason: '1 test failed',
          remaining: Math.max(1, ctx.maxRetries) - 1,
        },
        900,
      );
      implementation(script, 2, revisedPatch);
      testing(script, 2, true);
      review(script, 'approve', []);
      verification(script, 'sandbox-error');
      awaitApproval(script);
      return script.steps;
    },

    /** The retry budget runs out with a test still failing. */
    partial(ctx) {
      const script = new Script();
      start(script, { ...ctx, maxRetries: 1 });
      inspection(script);
      planning(script);
      implementation(script, 1, firstPatch);
      testing(script, 1, false);
      script.add(
        {
          type: 'retry.scheduled',
          attempt: 2,
          reason: '1 test failed',
          remaining: 0,
        },
        900,
      );
      implementation(script, 2, revisedPatch);
      testing(script, 2, false);
      script.add(
        {
          type: 'log',
          level: 'warn',
          text: 'Retry budget exhausted after 2 attempts',
        },
        600,
      );
      review(script, 'request_changes', [
        'The exhausted-budget case is still off by one',
      ]);
      verification(script, 'pass');
      awaitApproval(script);
      return script.steps;
    },

    /** The developer agent cannot produce a change. */
    failed(ctx) {
      const script = new Script();
      start(script, ctx);
      inspection(script);
      planning(script);
      script
        .add(
          {
            type: 'stage.started',
            stage: 'implementation',
            attempt: 1,
            agent: 'developer',
          },
          700,
        )
        .add(
          {
            type: 'operation',
            agent: 'developer',
            text: 'Reproducing the reported failure',
          },
          400,
        )
        .add(
          {
            type: 'command.started',
            commandId: 'cmd-repro',
            command: 'pnpm test -- tests/retry.test.ts',
            cwd: null,
          },
          800,
        )
        .add(
          {
            type: 'command.output',
            commandId: 'cmd-repro',
            stream: 'stdout',
            text: ' ✓ tests/retry.test.ts (2)\n\n Tests  2 passed (2)\n',
          },
          3000,
        )
        .add(
          {
            type: 'command.finished',
            commandId: 'cmd-repro',
            exitCode: 0,
            durationMs: 3100,
          },
          100,
        )
        .add(
          {
            type: 'agent.note',
            agent: 'developer',
            text: 'The failure described in the task does not reproduce on the base commit. No change was made rather than guessing at a fix.',
          },
          1500,
        )
        .add(
          {
            type: 'stage.finished',
            stage: 'implementation',
            attempt: 1,
            status: 'failed',
            summary: null,
            failureReason: 'Could not reproduce the failure; no change made',
          },
          600,
        )
        .add({ type: 'run.finished', status: 'completed', error: null }, 800);
      return script.steps;
    },

    investigation(ctx) {
      const script = new Script();
      start(script, ctx, false);
      inspection(script);
      planning(script);
      script
        .add(
          {
            type: 'stage.finished',
            stage: 'implementation',
            attempt: 1,
            status: 'skipped',
            summary: 'Investigation only',
            failureReason: null,
          },
          300,
        )
        .add(
          {
            type: 'stage.finished',
            stage: 'testing',
            attempt: 1,
            status: 'skipped',
            summary: 'Investigation only',
            failureReason: null,
          },
          200,
        )
        .add(
          {
            type: 'stage.started',
            stage: 'review',
            attempt: 1,
            agent: 'review',
          },
          600,
        )
        .add(
          {
            type: 'agent.note',
            agent: 'review',
            text: 'The report names the cause with evidence at src/retry.ts:41 and src/tasks/run.ts:88. It separates the confirmed reset from the suspected effect on billing.',
          },
          2400,
        )
        .add(
          {
            type: 'review.finished',
            verdict: 'approve',
            concerns: [],
            acceptanceCriteriaMet: true,
          },
          300,
        )
        .add(
          {
            type: 'stage.finished',
            stage: 'review',
            attempt: 1,
            status: 'passed',
            summary: 'Report reviewed',
            failureReason: null,
          },
          400,
        )
        .add(
          {
            type: 'stage.finished',
            stage: 'verification',
            attempt: 1,
            status: 'skipped',
            summary: 'Nothing to verify',
            failureReason: null,
          },
          200,
        )
        .add({ type: 'run.finished', status: 'completed', error: null }, 600);
      return script.steps;
    },
  };

export const scenarioForCategory = (category: TaskCategory): ScenarioName =>
  category === 'investigate' ? 'investigation' : 'happy';

/** A task title can ask for a particular ending, for demos and tests. */
export function scenarioForTask(
  category: TaskCategory,
  title: string,
): ScenarioName {
  const lower = title.toLowerCase();
  if (lower.includes('unverified')) return 'retry-then-unverified';
  if (lower.includes('partial')) return 'partial';
  if (lower.includes('fail')) return 'failed';
  return scenarioForCategory(category);
}

export const scenarioDuration = (steps: Step[]) => steps.at(-1)?.at ?? 0;
