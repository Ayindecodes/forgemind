import { z } from 'zod';

import { Id, Timestamp } from './common';

export const Notification = z.object({
  id: Id,
  kind: z.enum([
    'task_awaiting_approval',
    'task_failed',
    'task_completed',
    'finding_detected',
    'pull_request_updated',
    'member_joined',
  ]),
  title: z.string().min(1),
  body: z.string(),
  href: z.string().nullable(),
  readAt: Timestamp.nullable(),
  createdAt: Timestamp,
});

export const AuditEvent = z.object({
  id: Id,
  actorId: Id,
  actorName: z.string().min(1),
  action: z.string().min(1),
  target: z.object({ type: z.string().min(1), id: Id, label: z.string() }),
  at: Timestamp,
});

export type Notification = z.infer<typeof Notification>;
export type AuditEvent = z.infer<typeof AuditEvent>;
