'use client';

import type { Run } from '@forgemind/contract';

import { Badge } from '@/components/ui/badge';
import { Status, type StatusValue } from '@/components/ui/status';
import { cx } from '@/lib/cx';
import { formatDuration } from '@/lib/format';
import type {
  AttemptView,
  CheckView,
  RunView,
  SecurityStep,
  StageView,
} from '@/lib/live/derive';
import { agentLabels, stageLabels } from '@/lib/run-labels';
import { useNow } from '@/lib/use-now';

/*
 * The seven stages, each with every attempt it had. A failed attempt stays
 * exactly as it was; a retry adds the next one beneath it.
 */

export const checkStatus = (status: CheckView['status']): StatusValue =>
  status === 'error' ? 'failed' : status;

const span = (from: string | null, to: string | null, now: number) => {
  if (!from) return null;
  const end = to ? Date.parse(to) : now;
  return Math.max(0, end - Date.parse(from));
};

export function Timeline({ view, run }: { view: RunView; run: Run }) {
  const now = useNow(
    run.status === 'running' || run.status === 'awaiting_approval',
  );

  return (
    <section aria-labelledby="timeline-title" className="material-solid">
      <h2
        id="timeline-title"
        className="border-b border-line px-4 py-3 text-sm font-semibold"
      >
        Timeline
      </h2>
      <ol aria-label="Stages" className="divide-y divide-line">
        {view.stages.map((stage) => (
          <StageItem key={stage.id} stage={stage} run={run} now={now} />
        ))}
      </ol>
    </section>
  );
}

function StageItem({
  stage,
  run,
  now,
}: {
  stage: StageView;
  run: Run;
  now: number;
}) {
  const last = stage.attempts.at(-1);
  const duration = span(
    stage.startedAt,
    stage.status === 'running' ? null : stage.finishedAt,
    now,
  );
  const open =
    stage.status === 'running' ||
    stage.status === 'failed' ||
    stage.attempts.length > 1;

  return (
    <li
      data-testid={`stage-${stage.id}`}
      data-status={stage.status}
      data-attempts={stage.attempts.length}
      className="px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Status
          status={stage.status}
          label={stageLabels[stage.id]}
          className={cx(stage.status === 'pending' && 'text-fg-muted')}
        />
        {stage.attempts.length > 1 && (
          <Badge tone="warning">{stage.attempts.length} attempts</Badge>
        )}
        {duration !== null && (
          <span className="text-sm text-fg-secondary tabular-nums">
            {stage.id === 'approval' && run.status === 'awaiting_approval'
              ? `waiting ${formatDuration(duration)}`
              : formatDuration(duration)}
          </span>
        )}
        {last?.failureReason ? (
          <span className="text-sm text-error-fg">{last.failureReason}</span>
        ) : (
          last?.summary && (
            <span className="text-sm text-fg-secondary">{last.summary}</span>
          )
        )}
      </div>

      {stage.id === 'review' && last?.security && (
        <SecurityItem step={last.security} />
      )}

      {stage.status === 'running' && run.status === 'awaiting_approval' && (
        <p className="mt-2 text-sm text-fg-secondary">
          Waiting for a decision. Nothing is running.
        </p>
      )}
      {stage.status === 'running' && run.status === 'running' && (
        <p className="mt-2 text-sm">
          <span className="font-medium">
            {run.activeAgent ? agentLabels[run.activeAgent] : 'Orchestrator'}
          </span>
          <span className="text-fg-secondary">
            {run.currentOperation ? `: ${run.currentOperation}` : ' is working'}
          </span>
          {run.activeFiles.length > 0 && (
            <span className="mt-1 block font-mono text-xs text-fg-muted">
              {run.activeFiles.slice(-4).join('   ')}
            </span>
          )}
        </p>
      )}

      {stage.attempts.length > 0 && (
        <details open={open} className="mt-2 text-sm">
          <summary className="cursor-pointer text-fg-secondary select-none">
            {stage.attempts.length === 1
              ? 'What happened'
              : `${stage.attempts.length} attempts`}
          </summary>
          <ol
            aria-label={`Attempts of ${stageLabels[stage.id]}`}
            className="mt-2 flex flex-col gap-2"
          >
            {stage.attempts.map((attempt) => (
              <AttemptItem
                key={attempt.number}
                attempt={attempt}
                now={now}
                // The latest review's security step already shows above.
                showSecurity={stage.attempts.length > 1}
              />
            ))}
          </ol>
        </details>
      )}
    </li>
  );
}

function AttemptItem({
  attempt,
  now,
  showSecurity,
}: {
  attempt: AttemptView;
  now: number;
  showSecurity: boolean;
}) {
  const duration = span(attempt.startedAt, attempt.finishedAt, now);

  return (
    <li
      data-testid={`attempt-${attempt.stage}-${attempt.number}`}
      data-status={attempt.status}
      className="rounded-md border border-line bg-elevated p-3"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Status
          status={attempt.status}
          size="sm"
          label={`Attempt ${attempt.number}`}
        />
        {attempt.agent && (
          <span className="text-fg-secondary">
            {agentLabels[attempt.agent]}
          </span>
        )}
        {duration !== null && (
          <span className="text-fg-muted tabular-nums">
            {formatDuration(duration)}
          </span>
        )}
      </div>
      {attempt.summary && (
        <p className="mt-1 text-fg-secondary">{attempt.summary}</p>
      )}
      {attempt.failureReason && (
        <p className="mt-1 text-error-fg">{attempt.failureReason}</p>
      )}
      {showSecurity && attempt.security && (
        <SecurityItem step={attempt.security} />
      )}

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-fg-secondary">
        {attempt.inspected.length > 0 && (
          <>
            <dt>Inspected</dt>
            <dd className="font-mono text-xs break-all">
              {attempt.inspected.join(', ')}
            </dd>
          </>
        )}
        {attempt.changed.length > 0 && (
          <>
            <dt>Changed</dt>
            <dd className="flex flex-col">
              {attempt.changed.map((file, index) => (
                <span key={index} className="font-mono text-xs break-all">
                  {file.path}{' '}
                  <span className="text-success-fg">+{file.additions}</span>{' '}
                  <span className="text-error-fg">−{file.deletions}</span>
                </span>
              ))}
            </dd>
          </>
        )}
        {attempt.commands.length > 0 && (
          <>
            <dt>Commands</dt>
            <dd className="flex flex-col">
              {attempt.commands.map((command) => (
                <span key={command.id} className="font-mono text-xs break-all">
                  $ {command.command}
                  {command.exitCode !== null && (
                    <span
                      className={cx(
                        'ml-2',
                        command.exitCode === 0
                          ? 'text-fg-muted'
                          : 'text-error-fg',
                      )}
                    >
                      exit {command.exitCode}
                    </span>
                  )}
                </span>
              ))}
            </dd>
          </>
        )}
        {attempt.checks.length > 0 && (
          <>
            <dt>Checks</dt>
            <dd className="flex flex-col gap-0.5">
              {attempt.checks.map((check) => (
                <Status
                  key={check.id}
                  status={checkStatus(check.status)}
                  size="sm"
                  label={`${check.label}${check.summary ? `: ${check.summary}` : ''}`}
                />
              ))}
            </dd>
          </>
        )}
        {attempt.notes.length > 0 && (
          <>
            <dt>Notes</dt>
            <dd className="flex flex-col gap-1">
              {attempt.notes.map((note) => (
                <span
                  key={note.seq}
                  className="flex flex-wrap items-baseline gap-2"
                >
                  <Badge tone="info">Agent note</Badge>
                  <span>{note.text}</span>
                </span>
              ))}
            </dd>
          </>
        )}
      </dl>
    </li>
  );
}

function SecurityItem({ step }: { step: SecurityStep }) {
  return (
    <div
      data-testid="security-step"
      data-status={step.status}
      className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-line px-2.5 py-1.5"
    >
      <Badge tone="info">Security</Badge>
      <Status
        status={checkStatus(step.status)}
        size="sm"
        label={
          step.check
            ? `${step.check.label} ${step.check.status}`
            : (step.operations.at(-1) ?? 'Security review')
        }
      />
      {step.check?.summary && (
        <span className="text-fg-secondary">{step.check.summary}</span>
      )}
    </div>
  );
}
