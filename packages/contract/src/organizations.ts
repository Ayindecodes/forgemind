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

export const InviteMember = z.object({
  email: z.email(),
  name: z.string().min(1).max(80),
  role: Role,
});

export const UpdateMemberRole = z.object({ role: Role });

export type InviteMember = z.infer<typeof InviteMember>;
export type UpdateMemberRole = z.infer<typeof UpdateMemberRole>;
export type Organization = z.infer<typeof Organization>;
export type Member = z.infer<typeof Member>;
