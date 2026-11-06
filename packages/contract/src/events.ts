import { z } from 'zod';

import { Id, Timestamp } from './common';
import { AgentType, ReviewVerdict, StageId } from './runs';
import { CheckKind } from './verification';

/*
 * Everything a run does is an event. The run's state is a fold over them,
 * so the UI can replay a run exactly as it happened. Every event is something
 * that really occurred; the one AI-authored kind, agent.note, says so.
 */

const base = {
  id: Id,
  runId: Id,
  seq: z.int().min(1),
  at: Timestamp,
};

const event = <T extends string, P extends z.ZodRawShape>(
  type: T,
  payload: P,
) => z.object({ ...base, type: z.literal(type), ...payload });

export const FileChange = z.enum(['added', 'modified', 'deleted', 'renamed']);

export const Event = z.discriminatedUnion('type', [
  event('run.started', {
    baseCommit: z.string().min(1),
    branch: z.string().nullable(),
    expectsPatch: z.boolean(),
    maxRetries: z.int().min(0),
  }),
  event('stage.started', {
    stage: StageId,
    attempt: z.int().min(1),
    agent: AgentType.nullable(),
  }),
  event('stage.finished', {
    stage: StageId,
    attempt: z.int().min(1),
    status: z.enum(['passed', 'failed', 'skipped']),
    summary: z.string().nullable(),
    failureReason: z.string().nullable(),
  }),
  /** Written by an agent. An explanation, not a record of execution. */
  event('agent.note', { agent: AgentType, text: z.string() }),
  /** What the system is doing right now. */
  event('operation', { agent: AgentType.nullable(), text: z.string() }),
  event('file.inspected', { path: z.string().min(1) }),
  event('file.changed', {
    path: z.string().min(1),
    change: FileChange,
    additions: z.int().min(0),
    deletions: z.int().min(0),
  }),
  event('command.started', {
    commandId: Id,
    command: z.string().min(1),
    cwd: z.string().nullable(),
  }),
  event('command.output', {
    commandId: Id,
    stream: z.enum(['stdout', 'stderr']),
    text: z.string(),
  }),
  event('command.finished', {
    commandId: Id,
    exitCode: z.int(),
    durationMs: z.int().min(0),
  }),
  event('check.started', {
    checkId: Id,
    kind: CheckKind,
    label: z.string().min(1),
    command: z.string().min(1),
    required: z.boolean(),
  }),
  event('check.finished', {
    checkId: Id,
    status: z.enum(['passed', 'failed', 'error', 'skipped']),
    durationMs: z.int().min(0),
    summary: z.string().nullable(),
    counts: z
      .object({
        passed: z.int().min(0),
        failed: z.int().min(0),
        skipped: z.int().min(0),
      })
      .nullable(),
  }),
  event('retry.scheduled', {
    /** The attempt number about to start. */
    attempt: z.int().min(2),
    reason: z.string(),
    remaining: z.int().min(0),
  }),
  event('review.finished', {
    verdict: ReviewVerdict,
    concerns: z.array(z.string()),
    acceptanceCriteriaMet: z.boolean(),
  }),
  event('resources.sampled', {
    cpuSeconds: z.number().min(0),
    memoryMb: z.number().min(0),
    sandboxSeconds: z.number().min(0),
  }),
  event('approval.requested', {}),
  event('run.finished', {
    status: z.enum(['completed', 'cancelled']),
    error: z.string().nullable(),
  }),
  event('log', { level: z.enum(['info', 'warn', 'error']), text: z.string() }),
]);

export const EventType = z.enum(
  Event.options.map((option) => option.shape.type.value),
);

export const EventQuery = z.object({
  /** Return events after this sequence number. */
  after: z.coerce.number().int().min(0).default(0),
});

export type Event = z.infer<typeof Event>;
export type EventType = z.infer<typeof EventType>;
export type EventOf<T extends EventType> = Extract<Event, { type: T }>;
export type EventQuery = z.infer<typeof EventQuery>;
