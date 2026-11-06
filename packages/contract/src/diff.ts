import { z } from 'zod';

import { Id } from './common';
import { FileChange } from './events';

export const DiffFile = z.object({
  path: z.string().min(1),
  previousPath: z.string().nullable(),
  change: FileChange,
  additions: z.int().min(0),
  deletions: z.int().min(0),
  language: z.string().nullable(),
  /** A unified diff of this file. */
  patch: z.string(),
  /** Written by the developer agent. An explanation, not a fact. */
  explanation: z.string().nullable(),
});

export const RunDiff = z.object({
  runId: Id,
  baseCommit: z.string().min(1),
  headCommit: z.string().min(1).nullable(),
  files: z.array(DiffFile),
});

export type DiffFile = z.infer<typeof DiffFile>;
export type RunDiff = z.infer<typeof RunDiff>;
