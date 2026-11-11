import type {
  Member,
  Notification,
  Repository,
  Run,
  Task,
} from '@forgemind/contract';

import { Blocked, type Context, type Probe } from './types';

/*
 * Every endpoint in the contract, in an order where each probe can use what
 * earlier ones learned. Reads come first against the seeded data, then the
 * mutations, then the sign-in and installation flows on a fresh session.
 */

const need = (context: Context, key: string, what: string) => {
  const value = context[key];
  if (!value) throw new Blocked(`needs ${what}`);
  return value;
};

type Page<T> = { items: T[] };

export const plan: Probe[] = [
  { key: 'health', build: () => ({}) },
  { key: 'session', build: () => ({}) },
  { key: 'organization', build: () => ({}) },
  { key: 'installation', build: () => ({}) },
  {
    key: 'githubRepositories',
    build: () => ({}),
    after: (context, data) => {
      const free = (
        data as {
          githubId: number;
          fullName: string;
          connectedRepositoryId: string | null;
        }[]
      ).find((repository) => repository.connectedRepositoryId === null);
      if (free) {
        context.freeGithubId = String(free.githubId);
        context.freeFullName = free.fullName;
      }
    },
  },
  { key: 'members', build: () => ({}) },
  {
    key: 'repositories',
    build: () => ({ query: { limit: '50' } }),
    after: (context, data) => {
      const items = (data as Page<Repository>).items;
      const analyzed = items.find(
        (repository) => repository.status === 'connected',
      );
      if (analyzed) context.repositoryId = analyzed.id;
    },
  },
  {
    key: 'repository',
    build: (context) => ({
      params: { id: need(context, 'repositoryId', 'a connected repository') },
    }),
  },
  {
    key: 'repositoryAnalysis',
    build: (context) => ({
      params: { id: need(context, 'repositoryId', 'a connected repository') },
    }),
  },
  {
    key: 'tasks',
    build: () => ({ query: { limit: '100' } }),
    // A seeded store playing its runs to the end still has some in flight
    // for a moment; the decisions below need them finished.
    settled: (data) =>
      !(data as Page<Task>).items.some(
        (task) => task.status === 'running' || task.status === 'queued',
      ),
    after: (context, data) => {
      const items = (data as Page<Task>).items;
      const first = items[0];
      if (first) context.taskId = first.id;
      const awaiting = items.filter(
        (task) => task.status === 'awaiting_approval',
      );
      awaiting.forEach((task, index) => {
        context[`awaitingTaskId${index}`] = task.id;
      });
      const finished = items.find(
        (task) =>
          task.status === 'awaiting_approval' || task.status === 'completed',
      );
      if (finished) context.finishedRunId = finished.runId;
    },
  },
  {
    key: 'task',
    build: (context) => ({ params: { id: need(context, 'taskId', 'a task') } }),
  },
  {
    key: 'taskRuns',
    build: (context) => ({ params: { id: need(context, 'taskId', 'a task') } }),
  },
  {
    key: 'runs',
    build: () => ({ query: { limit: '50' } }),
    after: (context, data) => {
      const items = (data as Page<Run>).items;
      const first = items[0];
      if (first) context.runId = first.id;
      // The stream probe reads one message, so it needs a run with events.
      const withEvents = items.find((run) => run.lastSeq > 0);
      if (withEvents) context.streamRunId = withEvents.id;
    },
  },
  {
    key: 'run',
    build: (context) => ({ params: { id: need(context, 'runId', 'a run') } }),
  },
  {
    key: 'runEvents',
    build: (context) => ({
      params: { id: need(context, 'runId', 'a run') },
      query: { after: '0' },
    }),
  },
  {
    key: 'runEventStream',
    transport: 'sse',
    build: (context) => ({
      params: { id: need(context, 'streamRunId', 'a run with events') },
      query: { after: '0' },
    }),
  },
  {
    key: 'runDiff',
    build: (context) => ({
      params: { id: need(context, 'finishedRunId', 'a finished run') },
    }),
  },
  {
    key: 'runReport',
    build: (context) => ({
      params: { id: need(context, 'finishedRunId', 'a finished run') },
    }),
  },
  { key: 'findings', build: () => ({ query: { limit: '50' } }) },
  { key: 'pullRequests', build: () => ({ query: { limit: '50' } }) },
  { key: 'usage', build: () => ({}) },
  {
    key: 'notifications',
    build: () => ({}),
    after: (context, data) => {
      const first = (data as Notification[])[0];
      if (first) context.notificationId = first.id;
    },
  },
  { key: 'audit', build: () => ({ query: { limit: '20' } }) },
  {
    key: 'markNotificationsRead',
    build: (context) => ({
      body: { ids: [need(context, 'notificationId', 'a notification')] },
    }),
  },

  // Mutations on the seeded organization.
  {
    key: 'createTask',
    status: 201,
    build: (context) => ({
      body: {
        repositoryId: need(context, 'repositoryId', 'a connected repository'),
        title: 'Conformance check task',
        request:
          'Created by the conformance harness to exercise the task endpoints.',
        category: 'docs',
      },
    }),
    after: (context, data) => {
      context.createdTaskId = (data as Task).id;
    },
  },
  {
    key: 'cancelTask',
    build: (context) => ({
      params: { id: need(context, 'createdTaskId', 'the created task') },
    }),
  },
  {
    key: 'connectRepository',
    status: 201,
    build: (context) => ({
      body: {
        githubId: Number(
          need(context, 'freeGithubId', 'an unconnected GitHub repository'),
        ),
        fullName: need(
          context,
          'freeFullName',
          'an unconnected GitHub repository',
        ),
      },
    }),
    after: (context, data) => {
      context.connectedRepositoryId = (data as Repository).id;
    },
  },
  {
    key: 'disconnectRepository',
    build: (context) => ({
      params: {
        id: need(
          context,
          'connectedRepositoryId',
          'the repository just connected',
        ),
      },
    }),
  },
  {
    key: 'inviteMember',
    status: 201,
    build: () => ({
      body: {
        email: `conformance-${Date.now()}@example.com`,
        name: 'Conformance Probe',
        role: 'developer',
      },
    }),
    after: (context, data) => {
      context.invitedUserId = (data as Member).user.id;
    },
  },
  {
    key: 'updateMemberRole',
    build: (context) => ({
      params: { id: need(context, 'invitedUserId', 'the invited member') },
      body: { role: 'reviewer' },
    }),
  },
  {
    key: 'removeMember',
    build: (context) => ({
      params: { id: need(context, 'invitedUserId', 'the invited member') },
    }),
  },
  {
    key: 'requestRevision',
    build: (context) => ({
      params: {
        id: need(context, 'awaitingTaskId0', 'a task awaiting approval'),
      },
      body: { instructions: 'Conformance harness: cover the remaining case.' },
    }),
  },

  {
    key: 'approveTask',
    build: (context) => ({
      params: {
        id: need(context, 'awaitingTaskId0', 'a task awaiting approval'),
      },
    }),
  },
  {
    key: 'openPullRequest',
    status: 201,
    build: (context) => ({
      params: { id: need(context, 'awaitingTaskId0', 'the approved task') },
    }),
  },
  {
    key: 'rejectTask',
    build: (context) => ({
      params: {
        id: need(context, 'awaitingTaskId1', 'a second task awaiting approval'),
      },
    }),
  },

  // Sign-in and installation as a new person, on a fresh session.
  {
    key: 'githubStart',
    build: () => ({ body: { next: '/tasks' }, cookie: '' }),
    after: (context, data) => {
      const redirect = data as { url: string; state: string };
      context.authorizeUrl = redirect.url;
      context.authState = redirect.state;
    },
  },
  {
    key: 'githubCallback',
    build: (context) => ({
      body: {
        code: need(context, 'authCode', 'a code from the authorize page'),
        state: need(context, 'authState', 'the sign-in state'),
      },
      cookie: '',
    }),
    after: (context, _data, response) => {
      const cookie = response.headers.get('set-cookie') ?? '';
      const match = /fm_session=([^;]+)/.exec(cookie);
      if (match) context.newSession = `fm_session=${match[1]}`;
    },
  },
  {
    key: 'createOrganization',
    status: 201,
    build: (context) => ({
      body: { name: 'Conformance Org' },
      cookie: need(context, 'newSession', 'the new session'),
    }),
  },
  {
    key: 'installStart',
    build: (context) => ({
      cookie: need(context, 'newSession', 'the new session'),
    }),
    after: (context, data) => {
      const redirect = data as { url: string; state: string };
      context.installUrl = redirect.url;
      context.installState = redirect.state;
    },
  },
  {
    key: 'installCallback',
    status: 201,
    build: (context) => ({
      body: {
        installationId: need(
          context,
          'installationId',
          'an installation id from GitHub',
        ),
        state: need(context, 'installState', 'the install state'),
      },
      cookie: need(context, 'newSession', 'the new session'),
    }),
  },
  {
    key: 'signOut',
    build: (context) => ({
      cookie: need(context, 'newSession', 'the new session'),
    }),
  },
];
