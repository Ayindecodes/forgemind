import { z } from 'zod';

import { Id, Timestamp } from './common';

export const Role = z.enum([
  'owner',
  'admin',
  'developer',
  'reviewer',
  'viewer',
]);

export const User = z.object({
  id: Id,
  email: z.email(),
  name: z.string().min(1),
  avatarUrl: z.url().nullable(),
  githubLogin: z.string().nullable(),
  createdAt: Timestamp,
});

/** A signed-in user. Organization and role are null until onboarding creates them. */
export const Session = z.object({
  user: User,
  organizationId: Id.nullable(),
  role: Role.nullable(),
  expiresAt: Timestamp,
});

/** Why a session request was refused. Sent in the error's details. */
export const SessionReason = z.enum(['signed_out', 'expired']);

export const GitHubStart = z.object({
  /** Where to go after signing in. A path on this app, never a full URL. */
  next: z
    .string()
    .regex(/^\/(?!\/)/)
    .optional(),
});

/** Where the browser must go to continue with GitHub. */
export const GitHubRedirect = z.object({
  url: z.url(),
  state: z.string().min(1),
});

export const GitHubCallback = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

export const Permission = z.object({
  name: z.string().min(1),
  access: z.enum(['read', 'write']),
  /** Why ForgeMind needs it, in plain words. */
  reason: z.string().min(1),
});

/** The ForgeMind GitHub App, installed on the organization's GitHub account. */
export const Installation = z.object({
  id: Id,
  accountLogin: z.string().min(1),
  accountType: z.enum(['user', 'organization']),
  repositorySelection: z.enum(['all', 'selected']),
  permissions: z.array(Permission),
  installedAt: Timestamp,
});

export const InstallationState = z.object({
  installation: Installation.nullable(),
});

export const InstallCallback = z.object({
  installationId: z.string().min(1),
  state: z.string().min(1),
});

/** A repository the installation can see, whether or not it is connected yet. */
export const GitHubRepository = z.object({
  githubId: z.int(),
  fullName: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
  private: z.boolean(),
  defaultBranch: z.string().min(1),
  description: z.string().nullable(),
  pushedAt: Timestamp,
  connectedRepositoryId: Id.nullable(),
});

export const CreateOrganization = z.object({
  name: z.string().trim().min(2).max(80),
});

export type Role = z.infer<typeof Role>;
export type User = z.infer<typeof User>;
export type Session = z.infer<typeof Session>;
export type SessionReason = z.infer<typeof SessionReason>;
export type GitHubStart = z.infer<typeof GitHubStart>;
export type GitHubRedirect = z.infer<typeof GitHubRedirect>;
export type GitHubCallback = z.infer<typeof GitHubCallback>;
export type Permission = z.infer<typeof Permission>;
export type Installation = z.infer<typeof Installation>;
export type InstallationState = z.infer<typeof InstallationState>;
export type InstallCallback = z.infer<typeof InstallCallback>;
export type GitHubRepository = z.infer<typeof GitHubRepository>;
export type CreateOrganization = z.infer<typeof CreateOrganization>;
