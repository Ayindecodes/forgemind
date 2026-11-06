import { z } from 'zod';

import { Id, Timestamp } from './common';

export const TaskCategory = z.enum([
  'investigate',
  'fix_bug',
  'add_tests',
  'security',
  'dependencies',
  'refactor',
  'docs',
  'validation',
]);

/** Investigations report; everything else is expected to produce a patch. */
export const categoryExpectsPatch = (category: TaskCategory) =>
  category !== 'investigate';

export const TaskStatus = z.enum([
  'queued',
  'running',
  'awaiting_approval',
  'completed',
  'cancelled',
  'failed',
]);

export const Decision = z.enum(['approved', 'rejected', 'revision_requested']);

export const Budget = z.object({
  maxMinutes: z.int().min(1).max(480),
  maxRetries: z.int().min(0).max(10),
  maxTokens: z.int().min(1000),
});

export const Task = z.object({
  id: Id,
  organizationId: Id,
  repositoryId: Id,
  title: z.string().min(1),
  /** What the user asked for, verbatim. */
  request: z.string().min(1),
  category: TaskCategory,
  baseCommit: z.string().min(1),
  branch: z.string().nullable(),
  status: TaskStatus,
  decision: Decision.nullable(),
  /** The latest run. Earlier runs stay reachable through the run endpoints. */
  runId: Id,
  budget: Budget,
  createdBy: Id,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

export const CreateTask = z.object({
  repositoryId: Id,
  title: z.string().min(1).max(200),
  request: z.string().min(1).max(5000),
  category: TaskCategory,
  budget: Budget.partial().optional(),
});

export const TaskQuery = z.object({
  repositoryId: Id.optional(),
  status: TaskStatus.optional(),
});

export type TaskCategory = z.infer<typeof TaskCategory>;
export type TaskStatus = z.infer<typeof TaskStatus>;
export type Decision = z.infer<typeof Decision>;
export type Budget = z.infer<typeof Budget>;
export type Task = z.infer<typeof Task>;
export type CreateTask = z.infer<typeof CreateTask>;
export type TaskQuery = z.infer<typeof TaskQuery>;
