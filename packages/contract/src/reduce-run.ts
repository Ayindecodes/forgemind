import type { Event } from './events';
import {
  deriveOutcome,
  stageOrder,
  type Attempt,
  type Run,
  type RunStatus,
  type Stage,
} from './runs';
import { deriveVerification, type Check } from './verification';

/*
 * Folds events into run state. The dev API and the UI both use this, so what
 * the UI shows is exactly what the events say, and outcome and verification
 * are recomputed from the checks after every event rather than ever set.
 */

export function initialRun(
  id: string,
  taskId: string,
  baseCommit: string,
): Run {
  return finalize({
    id,
    taskId,
    status: 'queued',
    outcome: null,
    verification: 'pending',
    expectsPatch: true,
    stages: stageOrder.map((stage) => ({
      id: stage,
      status: 'pending',
      attempts: [],
    })),
    checks: [],
    activeAgent: null,
    currentOperation: null,
    activeFiles: [],
    retries: { used: 0, max: 0 },
    diff: null,
    review: null,
    resources: { cpuSeconds: 0, memoryPeakMb: 0, sandboxSeconds: 0 },
    baseCommit,
    branch: null,
    lastSeq: 0,
    startedAt: null,
    finishedAt: null,
    error: null,
  });
}

const isFinished = (status: RunStatus) =>
  status === 'completed' ||
  status === 'awaiting_approval' ||
  status === 'cancelled';

function finalize(run: Run): Run {
  const verification = deriveVerification(run.checks, {
    finished: isFinished(run.status),
  });
  const next = { ...run, verification };

  return { ...next, outcome: deriveOutcome(next) };
}

function updateStage(
  run: Run,
  id: Stage['id'],
  update: (stage: Stage) => Stage,
): Run {
  return {
    ...run,
    stages: run.stages.map((stage) =>
      stage.id === id ? update(stage) : stage,
    ),
  };
}

function updateAttempt(
  stage: Stage,
  number: number,
  update: (attempt: Attempt) => Attempt,
): Stage {
  return {
    ...stage,
    attempts: stage.attempts.map((attempt) =>
      attempt.number === number ? update(attempt) : attempt,
    ),
  };
}

function updateCheck(
  run: Run,
  id: string,
  update: (check: Check) => Check,
): Run {
  return {
    ...run,
    checks: run.checks.map((check) =>
      check.id === id ? update(check) : check,
    ),
  };
}

export function reduceRun(run: Run, event: Event): Run {
  if (event.seq <= run.lastSeq) return run;

  const next = apply({ ...run, lastSeq: event.seq }, event);

  return finalize(next);
}

function apply(run: Run, event: Event): Run {
  switch (event.type) {
    case 'run.started':
      return {
        ...run,
        status: 'running',
        startedAt: event.at,
        baseCommit: event.baseCommit,
        branch: event.branch,
        expectsPatch: event.expectsPatch,
        retries: { used: 0, max: event.maxRetries },
      };

    case 'stage.started':
      return {
        ...updateStage(run, event.stage, (stage) => ({
          ...stage,
          status: 'running',
          attempts: [
            ...stage.attempts,
            {
              number: event.attempt,
              status: 'running',
              agent: event.agent,
              startedAt: event.at,
              finishedAt: null,
              summary: null,
              failureReason: null,
            },
          ],
        })),
        activeAgent: event.agent,
        currentOperation: null,
        activeFiles: [],
      };

    case 'stage.finished':
      return updateStage(run, event.stage, (stage) => ({
        ...updateAttempt(stage, event.attempt, (attempt) => ({
          ...attempt,
          status: event.status,
          finishedAt: event.at,
          summary: event.summary,
          failureReason: event.failureReason,
        })),
        status: event.status,
      }));

    case 'operation':
      return {
        ...run,
        currentOperation: event.text,
        activeAgent: event.agent ?? run.activeAgent,
      };

    case 'file.inspected':
      return {
        ...run,
        activeFiles: [...new Set([...run.activeFiles, event.path])].slice(-12),
      };

    case 'file.changed': {
      const diff = run.diff ?? { filesChanged: 0, additions: 0, deletions: 0 };
      return {
        ...run,
        activeFiles: [...new Set([...run.activeFiles, event.path])].slice(-12),
        diff: {
          filesChanged: diff.filesChanged + 1,
          additions: diff.additions + event.additions,
          deletions: diff.deletions + event.deletions,
        },
      };
    }

    case 'check.started':
      return {
        ...run,
        checks: [
          ...run.checks.filter((check) => check.id !== event.checkId),
          {
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
            outputArtifactId: null,
          },
        ],
      };

    case 'check.finished':
      return updateCheck(run, event.checkId, (check) => ({
        ...check,
        status: event.status,
        finishedAt: event.at,
        durationMs: event.durationMs,
        summary: event.summary,
        counts: event.counts,
      }));

    case 'retry.scheduled':
      return {
        ...run,
        retries: { ...run.retries, used: run.retries.used + 1 },
        // A retry re-runs the stages from implementation. Their checks run again.
        checks: [],
        diff: null,
        review: null,
      };

    case 'review.finished':
      return {
        ...run,
        review: {
          verdict: event.verdict,
          concerns: event.concerns,
          acceptanceCriteriaMet: event.acceptanceCriteriaMet,
        },
      };

    case 'resources.sampled':
      return {
        ...run,
        resources: {
          cpuSeconds: event.cpuSeconds,
          memoryPeakMb: Math.max(run.resources.memoryPeakMb, event.memoryMb),
          sandboxSeconds: event.sandboxSeconds,
        },
      };

    case 'approval.requested':
      return {
        ...run,
        status: 'awaiting_approval',
        activeAgent: null,
        currentOperation: null,
      };

    case 'run.finished':
      return {
        ...run,
        status: event.status,
        finishedAt: event.at,
        error: event.error,
        activeAgent: null,
        currentOperation: null,
        stages: run.stages.map((stage) =>
          stage.status === 'pending' || stage.status === 'running'
            ? { ...stage, status: 'skipped' }
            : stage,
        ),
      };

    case 'agent.note':
    case 'command.started':
    case 'command.output':
    case 'command.finished':
    case 'log':
      return run;
  }
}

export function runFromEvents(
  id: string,
  taskId: string,
  baseCommit: string,
  events: readonly Event[],
): Run {
  return events.reduce(reduceRun, initialRun(id, taskId, baseCommit));
}
