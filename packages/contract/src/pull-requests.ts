import { z } from 'zod';

import { Id, Timestamp } from './common';

export const PullRequest = z.object({
  id: Id,
  taskId: Id,
  runId: Id,
  repositoryId: Id,
  number: z.int().min(1),
  url: z.url(),
  title: z.string().min(1),
  branch: z.string().min(1),
  state: z.enum(['open', 'merged', 'closed']),
  reviewStatus: z.enum(['pending', 'approved', 'changes_requested']),
  checksStatus: z.enum(['pending', 'passed', 'failed']),
  createdAt: Timestamp,
  mergedAt: Timestamp.nullable(),
});

export type PullRequest = z.infer<typeof PullRequest>;
