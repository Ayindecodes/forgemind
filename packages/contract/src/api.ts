import { z } from 'zod';

import {
  CreateOrganization,
  GitHubCallback,
  GitHubRedirect,
  GitHubRepository,
  GitHubStart,
  InstallCallback,
  Installation,
  InstallationState,
  Session,
} from './auth';
import { Id, page, PageQuery } from './common';
import { RunDiff } from './diff';
import { Event, EventQuery } from './events';
import { Finding, FindingQuery } from './findings';
import { HealthResponse } from './health';
import { AuditEvent, Notification } from './notifications';
import { Member, Organization } from './organizations';
import { PullRequest } from './pull-requests';
import {
  ConnectRepository,
  Repository,
  RepositoryAnalysis,
} from './repositories';
import { Report } from './reports';
import { Run, RunQuery } from './runs';
import { CreateTask, Task, TaskQuery } from './tasks';
import { UsageSummary } from './usage';

/*
 * Every endpoint the frontend uses, with its schemas. The dev API implements
 * this; the real API must match it. Paths use :param for path parameters.
 */

export type Endpoint = {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodObject;
  response: z.ZodType;
};

const byId = z.object({ id: Id });
const ok = z.object({ ok: z.literal(true) });

export const endpoints = {
  health: { method: 'GET', path: '/health', response: HealthResponse },

  session: { method: 'GET', path: '/auth/session', response: Session },
  signOut: { method: 'POST', path: '/auth/sign-out', response: ok },
  githubStart: {
    method: 'POST',
    path: '/auth/github/start',
    body: GitHubStart,
    response: GitHubRedirect,
  },
  githubCallback: {
    method: 'POST',
    path: '/auth/github/callback',
    body: GitHubCallback,
    response: Session,
  },

  organization: {
    method: 'GET',
    path: '/organization',
    response: Organization,
  },
  createOrganization: {
    method: 'POST',
    path: '/organization',
    body: CreateOrganization,
    response: Organization,
  },
  installation: {
    method: 'GET',
    path: '/github/installation',
    response: InstallationState,
  },
  installStart: {
    method: 'POST',
    path: '/github/install/start',
    response: GitHubRedirect,
  },
  installCallback: {
    method: 'POST',
    path: '/github/install/callback',
    body: InstallCallback,
    response: Installation,
  },
  githubRepositories: {
    method: 'GET',
    path: '/github/repositories',
    response: z.array(GitHubRepository),
  },
  members: {
    method: 'GET',
    path: '/organization/members',
    response: z.array(Member),
  },

  repositories: {
    method: 'GET',
    path: '/repositories',
    query: PageQuery,
    response: page(Repository),
  },
  connectRepository: {
    method: 'POST',
    path: '/repositories',
    body: ConnectRepository,
    response: Repository,
  },
  repository: {
    method: 'GET',
    path: '/repositories/:id',
    params: byId,
    response: Repository,
  },
  disconnectRepository: {
    method: 'DELETE',
    path: '/repositories/:id',
    params: byId,
    response: ok,
  },
  repositoryAnalysis: {
    method: 'GET',
    path: '/repositories/:id/analysis',
    params: byId,
    response: RepositoryAnalysis,
  },

  tasks: {
    method: 'GET',
    path: '/tasks',
    query: PageQuery.extend(TaskQuery.shape),
    response: page(Task),
  },
  createTask: {
    method: 'POST',
    path: '/tasks',
    body: CreateTask,
    response: Task,
  },
  task: { method: 'GET', path: '/tasks/:id', params: byId, response: Task },
  cancelTask: {
    method: 'POST',
    path: '/tasks/:id/cancel',
    params: byId,
    response: Task,
  },
  approveTask: {
    method: 'POST',
    path: '/tasks/:id/approve',
    params: byId,
    response: Task,
  },
  rejectTask: {
    method: 'POST',
    path: '/tasks/:id/reject',
    params: byId,
    response: Task,
  },
  requestRevision: {
    method: 'POST',
    path: '/tasks/:id/revise',
    params: byId,
    body: z.object({ instructions: z.string().min(1).max(5000) }),
    response: Task,
  },
  openPullRequest: {
    method: 'POST',
    path: '/tasks/:id/pull-request',
    params: byId,
    response: PullRequest,
  },

  /** Every run in the organisation, newest first. */
  runs: {
    method: 'GET',
    path: '/runs',
    query: PageQuery.extend(RunQuery.shape),
    response: page(Run),
  },
  run: { method: 'GET', path: '/runs/:id', params: byId, response: Run },
  runEvents: {
    method: 'GET',
    path: '/runs/:id/events',
    params: byId,
    query: EventQuery,
    response: z.array(Event),
  },
  /** Server-sent events. Each message's id is the event's seq. */
  runEventStream: {
    method: 'GET',
    path: '/runs/:id/events/stream',
    params: byId,
    query: EventQuery,
    response: Event,
  },
  runDiff: {
    method: 'GET',
    path: '/runs/:id/diff',
    params: byId,
    response: RunDiff,
  },
  runReport: {
    method: 'GET',
    path: '/runs/:id/report',
    params: byId,
    response: Report,
  },
  taskRuns: {
    method: 'GET',
    path: '/tasks/:id/runs',
    params: byId,
    response: z.array(Run),
  },

  findings: {
    method: 'GET',
    path: '/findings',
    query: PageQuery.extend(FindingQuery.shape),
    response: page(Finding),
  },
  pullRequests: {
    method: 'GET',
    path: '/pull-requests',
    query: PageQuery,
    response: page(PullRequest),
  },
  usage: { method: 'GET', path: '/usage', response: UsageSummary },
  notifications: {
    method: 'GET',
    path: '/notifications',
    response: z.array(Notification),
  },
  markNotificationsRead: {
    method: 'POST',
    path: '/notifications/read',
    body: z.object({ ids: z.array(Id).min(1) }),
    response: ok,
  },
  audit: {
    method: 'GET',
    path: '/audit',
    query: PageQuery,
    response: page(AuditEvent),
  },
} as const satisfies Record<string, Endpoint>;

export type EndpointKey = keyof typeof endpoints;

/** Fills :params in a path. */
export function buildPath(path: string, params: Record<string, string> = {}) {
  return path.replace(/:([a-zA-Z]+)/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`Missing path parameter ${name}`);
    return encodeURIComponent(value);
  });
}
