import type { Run } from '@forgemind/contract';

import { stageLabels } from '@/lib/run-labels';

/*
 * What a screen reader should hear as a run moves: stage changes, the run's
 * status, and the verdict on verification. Operations and file reads are
 * too frequent to speak; they stay on screen.
 */

const runStatusWords: Record<Run['status'], string> = {
  queued: 'Run queued',
  running: 'Run started',
  awaiting_approval: 'Run finished its work and is waiting for your decision',
  completed: 'Run completed',
  cancelled: 'Run cancelled',
};

const verificationWords: Record<Run['verification'], string | null> = {
  pending: null,
  verified: 'Verified: every required check passed',
  failed: 'Verification failed',
  unverified: 'Unverified: not every required check ran and passed',
};

/** The sentences for what changed between two snapshots of a run. */
export function announcements(previous: Run | null, next: Run): string[] {
  const lines: string[] = [];
  if (!previous || previous.status !== next.status) {
    lines.push(runStatusWords[next.status]);
  }
  for (const stage of next.stages) {
    const before = previous?.stages.find(
      (candidate) => candidate.id === stage.id,
    );
    if (before?.status === stage.status) continue;
    if (stage.status === 'pending') continue;
    const attempt = stage.attempts.at(-1);
    lines.push(
      `${stageLabels[stage.id]} ${stage.status}${
        attempt && attempt.number > 1 ? `, attempt ${attempt.number}` : ''
      }${attempt?.failureReason && stage.status === 'failed' ? `: ${attempt.failureReason}` : ''}`,
    );
  }
  if (
    previous?.verification !== next.verification &&
    verificationWords[next.verification]
  ) {
    lines.push(verificationWords[next.verification] as string);
  }
  if (previous && previous.retries.used !== next.retries.used) {
    lines.push(`Retry ${next.retries.used} of ${next.retries.max} scheduled`);
  }
  return lines;
}
