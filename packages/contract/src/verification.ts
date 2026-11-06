import { z } from 'zod';

import { Id, Timestamp } from './common';

export const CheckKind = z.enum([
  'tests',
  'build',
  'lint',
  'typecheck',
  'security_scan',
]);

export const CheckStatus = z.enum([
  'not_run',
  'running',
  'passed',
  'failed',
  'error',
  'skipped',
]);

export const Check = z.object({
  id: Id,
  kind: CheckKind,
  label: z.string().min(1),
  command: z.string().min(1),
  /** A patch is only verified once every required check has passed. */
  required: z.boolean(),
  status: CheckStatus,
  startedAt: Timestamp.nullable(),
  finishedAt: Timestamp.nullable(),
  durationMs: z.int().min(0).nullable(),
  summary: z.string().nullable(),
  counts: z
    .object({
      passed: z.int().min(0),
      failed: z.int().min(0),
      skipped: z.int().min(0),
    })
    .nullable(),
  outputArtifactId: Id.nullable(),
});

export const VerificationStatus = z.enum([
  'pending',
  'verified',
  'failed',
  'unverified',
]);

/**
 * The only way a run becomes "verified": it has finished, and every required
 * check ran and passed. Anything that did not run, errored or was skipped
 * leaves it unverified. While the run is still going, nothing is verified yet.
 */
export function deriveVerification(
  checks: readonly Check[],
  { finished }: { finished: boolean },
): VerificationStatus {
  const required = checks.filter((check) => check.required);

  if (required.some((check) => check.status === 'failed')) return 'failed';
  if (!finished) return 'pending';
  if (
    required.length > 0 &&
    required.every((check) => check.status === 'passed')
  ) {
    return 'verified';
  }

  return 'unverified';
}

export type CheckKind = z.infer<typeof CheckKind>;
export type CheckStatus = z.infer<typeof CheckStatus>;
export type Check = z.infer<typeof Check>;
export type VerificationStatus = z.infer<typeof VerificationStatus>;
