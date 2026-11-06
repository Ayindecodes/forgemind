import { z } from 'zod';

import { Role, User } from './auth';
import { Id, Timestamp } from './common';

export const Organization = z.object({
  id: Id,
  name: z.string().min(1),
  slug: z.string().min(1),
  plan: z.enum(['free', 'team', 'enterprise']),
  createdAt: Timestamp,
});

export const Member = z.object({
  user: User,
  role: Role,
  joinedAt: Timestamp,
});

export type Organization = z.infer<typeof Organization>;
export type Member = z.infer<typeof Member>;
