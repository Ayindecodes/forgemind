import { z } from 'zod';

import { Id, Timestamp } from './common';

export const ConnectionStatus = z.enum([
  'connected',
  'analyzing',
  'error',
  'revoked',
]);

export const Language = z.object({
  name: z.string().min(1),
  /** Share of the codebase, 0 to 1. */
  share: z.number().min(0).max(1),
});

export const Repository = z.object({
  id: Id,
  organizationId: Id,
  githubId: z.int(),
  /** owner/name */
  fullName: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
  defaultBranch: z.string().min(1),
  private: z.boolean(),
  url: z.url(),
  status: ConnectionStatus,
  statusMessage: z.string().nullable(),
  languages: z.array(Language),
  lastAnalyzedCommit: z.string().nullable(),
  lastAnalyzedAt: Timestamp.nullable(),
  openFindings: z.int().min(0),
  latestTaskId: Id.nullable(),
  pushedAt: Timestamp,
  connectedAt: Timestamp,
});

export const ConnectRepository = z.object({
  githubId: z.int(),
  fullName: Repository.shape.fullName,
});

const Location = z.object({
  path: z.string().min(1),
  line: z.int().min(1).nullable(),
});

export const RepositoryAnalysis = z.object({
  repositoryId: Id,
  commit: z.string().min(1),
  analyzedAt: Timestamp,
  summary: z.string(),
  frameworks: z.array(z.string()),
  entryPoints: z.array(
    z.object({
      path: z.string(),
      kind: z.enum(['server', 'cli', 'web', 'worker', 'library']),
    }),
  ),
  modules: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
      description: z.string(),
      importance: z.enum(['core', 'supporting', 'peripheral']),
    }),
  ),
  dependencies: z.array(
    z.object({
      name: z.string(),
      version: z.string(),
      ecosystem: z.enum(['npm', 'pypi', 'cargo', 'go', 'maven', 'other']),
      vulnerable: z.boolean(),
      advisoryUrl: z.url().nullable(),
    }),
  ),
  testCommands: z.array(z.string()),
  buildCommands: z.array(z.string()),
  documentation: z.array(z.object({ path: z.string(), title: z.string() })),
  /** Potential weaknesses, each tied to the code that shows it. */
  concerns: z.array(
    z.object({
      title: z.string(),
      detail: z.string(),
      evidence: z.array(Location),
    }),
  ),
});

export type ConnectionStatus = z.infer<typeof ConnectionStatus>;
export type Repository = z.infer<typeof Repository>;
export type ConnectRepository = z.infer<typeof ConnectRepository>;
export type RepositoryAnalysis = z.infer<typeof RepositoryAnalysis>;
