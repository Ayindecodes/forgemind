import {
  stageOrder,
  type AgentType,
  type Check,
  type Event,
  type EventOf,
  type Run,
  type StageId,
  type StageStatus,
} from '@forgemind/contract';

/*
 * Views of a run built only from its events. Each attempt keeps everything
 * that happened inside it, so a failed attempt stays on the record after a
 * retry. Nothing here is inferred: a section exists only when the events
 * for it exist.
 */

export type CommandView = {
  id: string;
  command: string;
  cwd: string | null;
  stage: StageId;
  attempt: number;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  durationMs: number | null;
  output: { stream: 'stdout' | 'stderr'; text: string }[];
};

export type CheckView = {
  id: string;
  kind: Check['kind'];
  label: string;
  command: string;
  required: boolean;
  status: 'running' | 'passed' | 'failed' | 'error' | 'skipped';
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  summary: string | null;
  counts: { passed: number; failed: number; skipped: number } | null;
};

export type SecurityStep = {
  status: 'running' | 'passed' | 'failed' | 'error' | 'skipped';
  operations: string[];
  notes: EventOf<'agent.note'>[];
  check: CheckView | null;
};

export type AttemptView = {
  stage: StageId;
  number: number;
  agent: AgentType | null;
  status: StageStatus;
  startedAt: string;
  finishedAt: string | null;
  summary: string | null;
  failureReason: string | null;
  notes: EventOf<'agent.note'>[];
  operations: string[];
  inspected: string[];
  changed: EventOf<'file.changed'>[];
  commands: CommandView[];
  checks: CheckView[];
  /** Only on review attempts, and only when security work was recorded. */
  security: SecurityStep | null;
};

export type StageView = {
  id: StageId;
  status: StageStatus;
  attempts: AttemptView[];
  startedAt: string | null;
  finishedAt: string | null;
};

export type Plan = {
  text: string;
  agent: AgentType;
  at: string;
  summary: string | null;
};

export type RunView = {
  stages: StageView[];
  plan: Plan | null;
  retries: EventOf<'retry.scheduled'>[];
  commands: CommandView[];
  checks: CheckView[];
  /** The files of the latest implementation attempt: the current patch. */
  changed: EventOf<'file.changed'>[];
  inspected: string[];
  warnings: EventOf<'log'>[];
};

const key = (stage: StageId, attempt: number) => `${stage}#${attempt}`;

export function deriveRunView(events: readonly Event[], run: Run): RunView {
  const attempts = new Map<string, AttemptView>();
  const order: AttemptView[] = [];
  const commands = new Map<string, CommandView>();
  const checks = new Map<string, CheckView>();
  const retries: EventOf<'retry.scheduled'>[] = [];
  const warnings: EventOf<'log'>[] = [];
  let current: AttemptView | null = null;
  let plan: Plan | null = null;

  for (const event of events) {
    switch (event.type) {
      case 'stage.started': {
        const attempt: AttemptView = {
          stage: event.stage,
          number: event.attempt,
          agent: event.agent,
          status: 'running',
          startedAt: event.at,
          finishedAt: null,
          summary: null,
          failureReason: null,
          notes: [],
          operations: [],
          inspected: [],
          changed: [],
          commands: [],
          checks: [],
          security: null,
        };
        attempts.set(key(event.stage, event.attempt), attempt);
        order.push(attempt);
        current = attempt;
        break;
      }
      case 'stage.finished': {
        const attempt = attempts.get(key(event.stage, event.attempt));
        if (attempt) {
          attempt.status = event.status;
          attempt.finishedAt = event.at;
          attempt.summary = event.summary;
          attempt.failureReason = event.failureReason;
          if (event.stage === 'planning' && plan && plan.summary === null)
            plan.summary = event.summary;
        }
        if (current === attempt) current = null;
        break;
      }
      case 'agent.note':
        current?.notes.push(event);
        if (current?.stage === 'planning') {
          plan = {
            text: event.text,
            agent: event.agent,
            at: event.at,
            summary: null,
          };
        }
        if (event.agent === 'security') securityOf(current)?.notes.push(event);
        break;
      case 'operation':
        current?.operations.push(event.text);
        if (event.agent === 'security')
          securityOf(current)?.operations.push(event.text);
        break;
      case 'file.inspected':
        current?.inspected.push(event.path);
        break;
      case 'file.changed':
        current?.changed.push(event);
        break;
      case 'command.started': {
        const command: CommandView = {
          id: event.commandId,
          command: event.command,
          cwd: event.cwd,
          stage: current?.stage ?? 'inspection',
          attempt: current?.number ?? 1,
          startedAt: event.at,
          finishedAt: null,
          exitCode: null,
          durationMs: null,
          output: [],
        };
        commands.set(event.commandId, command);
        current?.commands.push(command);
        break;
      }
      case 'command.output':
        commands
          .get(event.commandId)
          ?.output.push({ stream: event.stream, text: event.text });
        break;
      case 'command.finished': {
        const command = commands.get(event.commandId);
        if (command) {
          command.finishedAt = event.at;
          command.exitCode = event.exitCode;
          command.durationMs = event.durationMs;
        }
        break;
      }
      case 'check.started': {
        const check: CheckView = {
          id: event.checkId,
          kind: event.kind,
          label: event.label,
          command: event.command,
          required: event.required,
          status: 'running',
          startedAt: event.at,
          finishedAt: null,
          durationMs: null,
          summary: null,
          counts: null,
        };
        // A check id repeats across attempts; each attempt keeps its own copy.
        checks.set(event.checkId, check);
        current?.checks.push(check);
        if (event.kind === 'security_scan') {
          const security = securityOf(current);
          if (security) {
            security.check = check;
            security.status = 'running';
          }
        }
        break;
      }
      case 'check.finished': {
        const check = checks.get(event.checkId);
        if (check) {
          check.status = event.status;
          check.finishedAt = event.at;
          check.durationMs = event.durationMs;
          check.summary = event.summary;
          check.counts = event.counts;
          if (check.kind === 'security_scan') {
            const owner = order.find(
              (attempt) => attempt.security?.check === check,
            );
            if (owner?.security) owner.security.status = event.status;
          }
        }
        break;
      }
      case 'retry.scheduled':
        retries.push(event);
        break;
      case 'log':
        if (event.level !== 'info') warnings.push(event);
        break;
      case 'run.started':
      case 'review.finished':
      case 'resources.sampled':
      case 'approval.requested':
      case 'run.finished':
        break;
    }
  }

  const stages: StageView[] = stageOrder.map((id) => {
    const own = order.filter((attempt) => attempt.stage === id);
    const fromRun = run.stages.find((stage) => stage.id === id);
    return {
      id,
      status: fromRun?.status ?? 'pending',
      attempts: own,
      startedAt: own[0]?.startedAt ?? null,
      finishedAt: own.at(-1)?.finishedAt ?? null,
    };
  });

  const lastImplementation = order
    .filter((attempt) => attempt.stage === 'implementation')
    .at(-1);

  return {
    stages,
    plan,
    retries,
    commands: [...commands.values()],
    // The checks that count are the run's own, reset by a retry.
    checks: run.checks.map((check) => ({
      id: check.id,
      kind: check.kind,
      label: check.label,
      command: check.command,
      required: check.required,
      status: check.status === 'not_run' ? 'skipped' : check.status,
      startedAt: check.startedAt ?? '',
      finishedAt: check.finishedAt,
      durationMs: check.durationMs,
      summary: check.summary,
      counts: check.counts,
    })),
    changed: lastImplementation?.changed ?? [],
    inspected: [...new Set(order.flatMap((attempt) => attempt.inspected))],
    warnings,
  };
}

/** Security work only exists as a step when it happened during review. */
function securityOf(attempt: AttemptView | null): SecurityStep | null {
  if (!attempt || attempt.stage !== 'review') return null;
  attempt.security ??= {
    status: 'running',
    operations: [],
    notes: [],
    check: null,
  };
  return attempt.security;
}

/** Why the run's verification is what it is, from the checks alone. */
export function explainVerification(run: Run): string {
  const required = run.checks.filter((check) => check.required);
  const failed = required.filter((check) => check.status === 'failed');
  const notPassed = required.filter((check) => check.status !== 'passed');

  switch (run.verification) {
    case 'verified':
      return `All ${required.length} required ${required.length === 1 ? 'check' : 'checks'} ran and passed.`;
    case 'failed':
      return `Required ${failed.length === 1 ? 'check' : 'checks'} failed: ${failed.map(({ label }) => label).join(', ')}.`;
    case 'pending':
      return 'The run has not finished, so nothing is verified yet.';
    case 'unverified':
      if (required.length === 0)
        return 'No required checks were recorded for this run.';
      return `${notPassed.length === required.length ? 'The' : 'Some'} required checks did not run to a pass: ${notPassed
        .map(
          ({ label, status }) =>
            `${label} (${status === 'not_run' ? 'not run' : status})`,
        )
        .join(', ')}.`;
  }
}
