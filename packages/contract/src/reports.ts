import { z } from 'zod';

import { Id, Timestamp } from './common';
import { Finding } from './findings';
import { Outcome } from './runs';
import { Check } from './verification';

/** The structured record of a completed run. */
export const Report = z.object({
  runId: Id,
  taskId: Id,
  repositoryId: Id,
  repositoryFullName: z.string().min(1),
  commit: z.string().min(1),
  task: z.string().min(1),
  investigation: z.string(),
  rootCause: z.string().nullable(),
  filesModified: z.array(z.string()),
  changes: z.string(),
  commands: z.array(z.string()),
  checks: z.array(Check),
  findings: z.array(Finding),
  unresolved: z.array(z.string()),
  outcome: Outcome,
  generatedAt: Timestamp,
});

export type Report = z.infer<typeof Report>;
