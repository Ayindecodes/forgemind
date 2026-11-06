import type { Finding, Run } from '@forgemind/contract';

import { checkStatus } from '@/components/run/timeline';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Status } from '@/components/ui/status';
import { explainVerification } from '@/lib/live/derive';

/*
 * What the reviewer can actually check: findings with their evidence or an
 * honest "none recorded", whether each one lands in this patch, the checks
 * that ran, and the review agent's verdict. Nothing here is inferred.
 */

export type Placement = 'in-patch' | 'file-not-in-patch' | 'line-not-in-patch';

const severityTone: Record<Finding['severity'], BadgeTone> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'neutral',
  info: 'info',
};

const placementText: Record<Exclude<Placement, 'in-patch'>, string> = {
  'file-not-in-patch': 'This file is not part of the patch.',
  'line-not-in-patch': 'This line is outside the lines the patch touches.',
};

export function EvidencePanel({
  run,
  findings,
  placements,
  onShowFinding,
}: {
  run: Run;
  findings: Finding[];
  placements: Record<string, Placement>;
  onShowFinding: (finding: Finding) => void;
}) {
  return (
    <div className="flex flex-col gap-4" data-testid="evidence">
      <section aria-labelledby="findings-title" className="material-solid">
        <h2
          id="findings-title"
          className="border-b border-line px-4 py-3 text-sm font-semibold"
        >
          Findings ({findings.length})
        </h2>
        {findings.length === 0 ? (
          <p className="px-4 py-3 text-sm text-fg-secondary">
            No findings were raised against this patch.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {findings.map((finding) => {
              const placement = placements[finding.id] ?? 'in-patch';
              return (
                <li
                  key={finding.id}
                  data-testid={`finding-${finding.id}`}
                  data-placement={placement}
                  className="flex flex-col gap-1.5 px-4 py-3 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={severityTone[finding.severity]}>
                      {finding.severity}
                    </Badge>
                    <span className="font-medium">{finding.title}</span>
                  </div>
                  <p className="font-mono text-xs text-fg-secondary">
                    {finding.location.path}
                    {finding.location.line !== null &&
                      `:${finding.location.line}`}
                    <span className="ml-2 font-sans">
                      {finding.tool}, {finding.confidence}
                    </span>
                  </p>
                  {finding.evidence ? (
                    <p className="text-fg-secondary">{finding.evidence}</p>
                  ) : (
                    <p
                      className="text-warning-fg"
                      data-testid="missing-evidence"
                    >
                      No evidence was recorded by {finding.tool}. Treat this as
                      a lead, not a fact.
                    </p>
                  )}
                  {placement === 'in-patch' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="self-start"
                      onClick={() => onShowFinding(finding)}
                      data-testid="show-finding"
                    >
                      Show in diff
                    </Button>
                  ) : (
                    <p
                      className="text-xs text-fg-muted"
                      data-testid="placement"
                    >
                      {placementText[placement]}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="checks-title" className="material-solid">
        <h2
          id="checks-title"
          className="border-b border-line px-4 py-3 text-sm font-semibold"
        >
          Checks
        </h2>
        <p className="px-4 pt-3 text-sm">
          <Status
            status={
              run.verification === 'verified'
                ? 'verified'
                : run.verification === 'failed'
                  ? 'failed'
                  : run.verification === 'unverified'
                    ? 'unverified'
                    : 'pending'
            }
            size="sm"
          />
        </p>
        <p className="px-4 pt-1 pb-3 text-sm text-fg-secondary">
          {explainVerification(run)}
        </p>
        {run.checks.length > 0 && (
          <ul className="divide-y divide-line border-t border-line">
            {run.checks.map((check) => (
              <li
                key={check.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2 text-sm"
              >
                <Status
                  status={checkStatus(
                    check.status === 'not_run' ? 'skipped' : check.status,
                  )}
                  size="sm"
                  label={check.label}
                />
                {check.summary && (
                  <span className="text-fg-secondary">{check.summary}</span>
                )}
                {!check.required && (
                  <span className="text-xs text-fg-muted">optional</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {run.review && (
        <section aria-labelledby="verdict-title" className="material-solid">
          <h2
            id="verdict-title"
            className="border-b border-line px-4 py-3 text-sm font-semibold"
          >
            Review agent
          </h2>
          <div className="flex flex-col gap-1 px-4 py-3 text-sm">
            <p>
              <Badge tone="info">Agent note</Badge>{' '}
              {run.review.verdict === 'approve'
                ? 'Approved'
                : run.review.verdict === 'request_changes'
                  ? 'Requested changes'
                  : 'Blocked'}
              {run.review.acceptanceCriteriaMet
                ? '. Acceptance criteria met.'
                : '. Acceptance criteria not met.'}
            </p>
            {run.review.concerns.length > 0 && (
              <ul className="list-disc pl-5 text-fg-secondary">
                {run.review.concerns.map((concern) => (
                  <li key={concern}>{concern}</li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
