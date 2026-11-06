import { z } from 'zod';

import { Id, Timestamp } from './common';
import { Check, deriveVerification, VerificationStatus } from './verification';

export const StageId = z.enum([
  'inspection',
  'planning',
  'implementation',
  'testing',
  'review',
  'verification',
  'approval',
]);

export const stageOrder = StageId.options;

export const StageStatus = z.enum([
  'pending',
  'running',
  'passed',
  'failed',
  'skipped',
]);

export const AgentType = z.enum([
  'orchestrator',
  'architect',
  'developer',
  'testing',
  'security',
  'review',
  'release',
]);

export const Attempt = z.object({
  number: z.int().min(1),
  status: StageStatus,
  agent: AgentType.nullable(),
  startedAt: Timestamp,
  finishedAt: Timestamp.nullable(),
  summary: z.string().nullable(),
  failureReason: z.string().nullable(),
});

/** A failed attempt stays in the record; a retry adds the next number. */
export const Stage = z.object({
  id: StageId,
  status: StageStatus,
  attempts: z.array(Attempt),
});

export const RunStatus = z.enum([
  'queued',
  'running',
  'awaiting_approval',
  'completed',
  'cancelled',
]);

export const Outcome = z.enum(['succeeded', 'partial', 'failed', 'unverified']);

export const ReviewVerdict = z.enum(['approve', 'request_changes', 'blocked']);

export const DiffSummary = z.object({
  filesChanged: z.int().min(0),
  additions: z.int().min(0),
  deletions: z.int().min(0),
});

export const ReviewSummary = z.object({
  verdict: ReviewVerdict,
  concerns: z.array(z.string()),
  acceptanceCriteriaMet: z.boolean(),
});

export const Resources = z.object({
  cpuSeconds: z.number().min(0),
  memoryPeakMb: z.number().min(0),
  sandboxSeconds: z.number().min(0),
});

const RunShape = z.object({
  id: Id,
  taskId: Id,
  status: RunStatus,
  /** Derived from the stages and checks. Never set directly. */
  outcome: Outcome.nullable(),
  /** Derived from the checks. Never set directly. */
  verification: VerificationStatus,
  expectsPatch: z.boolean(),
  stages: z.array(Stage).length(stageOrder.length),
  checks: z.array(Check),
  activeAgent: AgentType.nullable(),
  currentOperation: z.string().nullable(),
  activeFiles: z.array(z.string()),
  retries: z.object({ used: z.int().min(0), max: z.int().min(0) }),
  diff: DiffSummary.nullable(),
  review: ReviewSummary.nullable(),
  resources: Resources,
  baseCommit: z.string().min(1),
  branch: z.string().nullable(),
  /** Sequence number of the last event folded into this state. */
  lastSeq: z.int().min(0),
  startedAt: Timestamp.nullable(),
  finishedAt: Timestamp.nullable(),
  error: z.string().nullable(),
});

type RunShape = z.infer<typeof RunShape>;

const isFinished = (status: RunStatus) =>
  status === 'completed' ||
  status === 'awaiting_approval' ||
  status === 'cancelled';

/**
 * What a finished run amounts to. A patch is "succeeded" only when verified;
 * checks that ran and failed make it "partial"; checks that never ran leave
 * it "unverified". A run with no patch succeeded only if none was expected.
 */
export function deriveOutcome(run: RunShape): Outcome | null {
  if (!isFinished(run.status) || run.status === 'cancelled') return null;

  const stageFailed = run.stages.some((stage) => stage.status === 'failed');
  const hasPatch = run.diff !== null && run.diff.filesChanged > 0;

  if (run.error) return hasPatch ? 'unverified' : 'failed';
  if (!hasPatch)
    return run.expectsPatch || stageFailed ? 'failed' : 'succeeded';

  const verification = deriveVerification(run.checks, { finished: true });
  const required = run.checks.filter((check) => check.required);

  if (verification === 'verified') return stageFailed ? 'partial' : 'succeeded';
  if (verification === 'failed') {
    return required.every((check) => check.status === 'failed')
      ? 'failed'
      : 'partial';
  }

  return 'unverified';
}

/** Rejects any run whose outcome or verification was not derived from its checks. */
export const Run = RunShape.superRefine((run, ctx) => {
  run.stages.forEach((stage, index) => {
    if (stage.id !== stageOrder[index]) {
      ctx.addIssue({
        code: 'custom',
        path: ['stages', index, 'id'],
        message: `Expected stage ${stageOrder[index]} at position ${index}`,
      });
    }
  });

  const verification = deriveVerification(run.checks, {
    finished: isFinished(run.status),
  });
  if (run.verification !== verification) {
    ctx.addIssue({
      code: 'custom',
      path: ['verification'],
      message: `Verification must be ${verification}, derived from the checks`,
    });
  }

  const outcome = deriveOutcome(run);
  if (run.outcome !== outcome) {
    ctx.addIssue({
      code: 'custom',
      path: ['outcome'],
      message: `Outcome must be ${outcome ?? 'null'}, derived from the stages and checks`,
    });
  }
});

export type StageId = z.infer<typeof StageId>;
export type StageStatus = z.infer<typeof StageStatus>;
export type AgentType = z.infer<typeof AgentType>;
export type Attempt = z.infer<typeof Attempt>;
export type Stage = z.infer<typeof Stage>;
export type RunStatus = z.infer<typeof RunStatus>;
export type Outcome = z.infer<typeof Outcome>;
export type ReviewVerdict = z.infer<typeof ReviewVerdict>;
export type DiffSummary = z.infer<typeof DiffSummary>;
export type ReviewSummary = z.infer<typeof ReviewSummary>;
export type Resources = z.infer<typeof Resources>;
export type Run = z.infer<typeof Run>;
