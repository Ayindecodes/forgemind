import type { Run } from '@forgemind/contract';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Status } from '@/components/ui/status';
import { explainVerification, type RunView } from '@/lib/live/derive';

import { runStatus, verificationLabel, verificationStatus } from './run-status';

const verdicts = {
  approve: 'Approved by the review agent',
  request_changes: 'The review agent requested changes',
  blocked: 'Blocked by the review agent',
} as const;

/** What the run came to, and why, from its checks and review alone. */
export function OutcomePanel({ run, view }: { run: Run; view: RunView }) {
  if (run.status === 'queued' || run.status === 'running') return null;

  return (
    <section
      aria-labelledby="outcome-title"
      data-testid="outcome"
      data-outcome={run.outcome ?? ''}
      data-verification={run.verification}
      className="material-solid"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <h2 id="outcome-title" className="text-sm font-semibold">
          Outcome
        </h2>
        <Status status={runStatus(run)} size="sm" />
        {run.outcome && (
          <Button asChild size="sm" variant="ghost" className="ml-auto">
            <Link
              href={`/tasks/${run.taskId}/report`}
              data-testid="open-report"
            >
              Report
            </Link>
          </Button>
        )}
        {verificationStatus[run.verification] !== runStatus(run) && (
          <Status
            status={verificationStatus[run.verification]}
            size="sm"
            label={verificationLabel[run.verification]}
          />
        )}
      </div>
      <dl className="grid gap-x-6 gap-y-2 px-4 py-3 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-fg-secondary">Verification</dt>
        <dd>{explainVerification(run)}</dd>
        {run.review && (
          <>
            <dt className="text-fg-secondary">Review</dt>
            <dd>
              {verdicts[run.review.verdict]}
              {run.review.acceptanceCriteriaMet
                ? '. Acceptance criteria met.'
                : '. Acceptance criteria not met.'}
              {run.review.concerns.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-fg-secondary">
                  {run.review.concerns.map((concern) => (
                    <li key={concern}>{concern}</li>
                  ))}
                </ul>
              )}
            </dd>
          </>
        )}
        <dt className="text-fg-secondary">Patch</dt>
        <dd>
          {run.diff ? (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                {run.diff.filesChanged}{' '}
                {run.diff.filesChanged === 1 ? 'file' : 'files'} changed,{' '}
                <span className="text-success-fg">+{run.diff.additions}</span>{' '}
                <span className="text-error-fg">−{run.diff.deletions}</span>
              </span>
              <Button asChild size="sm" variant="secondary">
                <Link
                  href={`/tasks/${run.taskId}/review`}
                  data-testid="review-patch"
                >
                  Review the patch
                </Link>
              </Button>
            </span>
          ) : run.expectsPatch ? (
            'No change was produced.'
          ) : (
            'None expected: this task was an investigation.'
          )}
        </dd>
        {run.error && (
          <>
            <dt className="text-fg-secondary">Error</dt>
            <dd className="text-error-fg">{run.error}</dd>
          </>
        )}
        {view.retries.length > 0 && (
          <>
            <dt className="text-fg-secondary">Retries</dt>
            <dd>
              {run.retries.used} of {run.retries.max} used
              <ul className="mt-1 list-disc pl-5 text-fg-secondary">
                {view.retries.map((retry) => (
                  <li key={retry.seq}>
                    Attempt {retry.attempt}: {retry.reason}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {view.warnings.length > 0 && (
          <>
            <dt className="text-fg-secondary">Warnings</dt>
            <dd className="text-warning-fg">
              {view.warnings.map((warning) => (
                <p key={warning.seq}>{warning.text}</p>
              ))}
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}
