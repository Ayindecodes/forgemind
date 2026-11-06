import {
  categoryExpectsPatch,
  initialRun,
  reduceRun,
  type AuditEvent,
  type Check,
  type ConnectRepository,
  type CreateTask,
  type Decision,
  type DiffFile,
  type Event,
  type Finding,
  type FindingQuery,
  type GitHubRepository,
  type Installation,
  type Member,
  type Notification,
  type Organization,
  type Permission,
  type PullRequest,
  type Report,
  type Repository,
  type RepositoryAnalysis,
  type Role,
  type Run,
  type RunDiff,
  type Session,
  type Task,
  type TaskQuery,
  type UsageSummary,
  type User,
  type RunQuery,
  type InviteMember,
} from '@forgemind/contract';

import { ApiFailure } from './errors';
import { patches } from './patches';
import { play, type Player } from './player';
import {
  scenarioForTask,
  scenarios,
  type EventTemplate,
  type ScenarioName,
} from './scenarios';
import { seedStore } from './seed';

export type StoreOptions = {
  seed?: number;
  /** Scenario playback speed. Infinity plays every run to its end at once. */
  speed?: number;
  now?: () => Date;
  /** Where this API is reachable, for the simulated GitHub pages. */
  apiOrigin?: string;
  /** Where the web app is, for redirects back from the simulated GitHub. */
  webOrigin?: string;
};

export type RunRecord = {
  run: Run;
  events: Event[];
  scenario: ScenarioName;
  startedAt: Date;
  player: Player | null;
};

type RunStart = {
  startedAt: Date;
  /** Steps up to here are emitted at once with historical timestamps. */
  elapsedMs?: number;
  /** Wait this long before the first event, for a queued run. */
  delayMs?: number;
  /** Drop steps after this point, for a run that was cut short. */
  cutoffMs?: number;
};

/** A repository on GitHub as the simulated API knows it, before connection. */
export type GitHubRepositorySource = Omit<
  GitHubRepository,
  'connectedRepositoryId'
> & {
  languages: Repository['languages'];
};

export type GitHubAccount = {
  login: string;
  type: Installation['accountType'];
  repositories: GitHubRepositorySource[];
};

type SessionRecord = { userId: string; expiresAt: Date };
type PendingState =
  | { kind: 'sign-in'; next: string | null }
  | { kind: 'install'; userId: string; organizationId: string };

type Scoped<T> = T & { organizationId: string };

const ANALYSIS_MS = 8_000;
const SESSION_DAYS = 7;
const DAY = 86_400_000;

export const SESSION_COOKIE = 'fm_session';

/** What the ForgeMind GitHub App asks for, and why. Nothing more. */
export const APP_PERMISSIONS: Permission[] = [
  {
    name: 'Metadata',
    access: 'read',
    reason: 'List the repositories you choose.',
  },
  {
    name: 'Contents',
    access: 'write',
    reason: 'Read code and push working branches. Never the default branch.',
  },
  {
    name: 'Pull requests',
    access: 'write',
    reason: 'Open pull requests for you to review.',
  },
  {
    name: 'Checks',
    access: 'read',
    reason: 'Read CI results on pull requests.',
  },
  {
    name: 'Webhooks',
    access: 'read',
    reason: 'Hear about pushes and pull request changes.',
  },
];

const unauthorized = (reason: 'signed_out' | 'expired') =>
  new ApiFailure(
    'unauthorized',
    reason === 'expired' ? 'Your session has expired' : 'Sign in to continue',
    { reason },
  );

export function createStore(options: StoreOptions = {}) {
  const now = options.now ?? (() => new Date());
  const speed = options.speed ?? 1;
  const apiOrigin = options.apiOrigin ?? 'http://localhost:4000';
  const webOrigin = options.webOrigin ?? 'http://localhost:3200';

  const data = {
    users: new Map<string, User>(),
    sessions: new Map<string, SessionRecord>(),
    organizations: new Map<string, Organization>(),
    memberships: new Map<string, Member[]>(),
    installations: new Map<string, Installation>(),
    githubAccounts: new Map<string, GitHubAccount>(),
    pendingStates: new Map<string, PendingState>(),
    codes: new Map<string, { userId: string; state: string }>(),
    repositories: new Map<string, Repository>(),
    analyses: new Map<string, RepositoryAnalysis>(),
    tasks: new Map<string, Task>(),
    runs: new Map<string, RunRecord>(),
    findings: new Map<string, Finding>(),
    pullRequests: new Map<string, PullRequest>(),
    notifications: new Map<string, Scoped<Notification>>(),
    audit: [] as Scoped<AuditEvent>[],
  };

  const counters = new Map<string, number>();
  const nextId = (prefix: string) => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}-${next}`;
  };

  const listeners = new Map<string, Set<(event: Event) => void>>();

  const must = <T>(value: T | undefined, what: string, id: string): T => {
    if (value === undefined)
      throw new ApiFailure('not_found', `${what} ${id} not found`);
    return value;
  };

  /* Everything a tenant can see is checked against its organization. */
  const repository = (orgId: string, repoId: string) => {
    const repo = data.repositories.get(repoId);
    return must(
      repo?.organizationId === orgId ? repo : undefined,
      'Repository',
      repoId,
    );
  };
  const task = (orgId: string, taskId: string) => {
    const item = data.tasks.get(taskId);
    return must(
      item?.organizationId === orgId ? item : undefined,
      'Task',
      taskId,
    );
  };
  const record = (orgId: string, runId: string) => {
    const entry = data.runs.get(runId);
    const owner = entry && data.tasks.get(entry.run.taskId);
    return must(
      owner?.organizationId === orgId ? entry : undefined,
      'Run',
      runId,
    );
  };
  const requireOrg = (session: Session) => {
    if (!session.organizationId) {
      throw new ApiFailure('forbidden', 'Create an organization first');
    }
    return session.organizationId;
  };
  const requireRole = (session: Session, roles: Role[]) => {
    if (!session.role || !roles.includes(session.role)) {
      throw new ApiFailure(
        'forbidden',
        `This needs the ${roles.join(' or ')} role`,
      );
    }
  };

  const membershipOf = (userId: string) => {
    for (const [organizationId, members] of data.memberships) {
      const member = members.find((item) => item.user.id === userId);
      if (member) return { organizationId, role: member.role };
    }
    return null;
  };

  function audit(
    organizationId: string,
    actor: User,
    action: string,
    target: AuditEvent['target'],
  ) {
    data.audit.unshift({
      id: nextId('audit'),
      organizationId,
      actorId: actor.id,
      actorName: actor.name,
      action,
      target,
      at: now().toISOString(),
    });
  }

  function notify(
    organizationId: string,
    input: Omit<Notification, 'id' | 'readAt' | 'createdAt'>,
  ) {
    const id = nextId('note');
    data.notifications.set(id, {
      ...input,
      id,
      organizationId,
      readAt: null,
      createdAt: now().toISOString(),
    });
  }

  function syncTask(entry: RunRecord) {
    const current = data.tasks.get(entry.run.taskId);
    if (!current || current.runId !== entry.run.id) return;

    const { status, outcome } = entry.run;
    const taskStatus =
      status === 'completed'
        ? outcome === 'failed'
          ? 'failed'
          : 'completed'
        : status;

    data.tasks.set(current.id, {
      ...current,
      status: taskStatus,
      branch: entry.run.branch,
      updatedAt: entry.run.finishedAt ?? now().toISOString(),
    });
  }

  function emit(runId: string, template: EventTemplate, at?: Date): Event {
    const entry = must(data.runs.get(runId), 'Run', runId);
    const seq = entry.events.length + 1;
    const event = {
      id: `${runId}-${seq}`,
      runId,
      seq,
      at: (at ?? now()).toISOString(),
      ...template,
    } as Event;

    entry.events.push(event);
    entry.run = reduceRun(entry.run, event);
    syncTask(entry);
    listeners.get(runId)?.forEach((listener) => listener(event));

    if (event.type === 'approval.requested') {
      const owner = data.tasks.get(entry.run.taskId);
      if (owner) {
        notify(owner.organizationId, {
          kind: 'task_awaiting_approval',
          title: `${owner.title} is ready for review`,
          body: `Outcome: ${entry.run.outcome ?? 'unknown'}.`,
          href: `/tasks/${owner.id}`,
        });
      }
    }

    return event;
  }

  function startRun(runId: string, start: RunStart) {
    const entry = must(data.runs.get(runId), 'Run', runId);
    const steps = scenarios[entry.scenario]({
      baseCommit: entry.run.baseCommit,
      branch: `forgemind/${entry.run.taskId}`,
      maxRetries: entry.run.retries.max || 2,
      category: data.tasks.get(entry.run.taskId)?.category,
    }).filter(
      (step) => start.cutoffMs === undefined || step.at <= start.cutoffMs,
    );

    const begin = () => {
      entry.player = play(steps, {
        speed,
        elapsedMs: start.elapsedMs ?? 0,
        startedAt: start.startedAt,
        emit: (template, at) => emit(runId, template, at),
      });
    };

    if (start.delayMs !== undefined && speed !== Infinity) {
      const timer = setTimeout(begin, start.delayMs / speed);
      timer.unref?.();
    } else {
      begin();
    }
  }

  function createRun(
    owner: Task,
    scenario: ScenarioName,
    start: RunStart,
  ): RunRecord {
    const runId = nextId('run');
    const base = initialRun(runId, owner.id, owner.baseCommit);
    const entry: RunRecord = {
      run: {
        ...base,
        expectsPatch: categoryExpectsPatch(owner.category),
        retries: { used: 0, max: owner.budget.maxRetries },
      },
      events: [],
      scenario,
      startedAt: start.startedAt,
      player: null,
    };
    data.runs.set(runId, entry);
    data.tasks.set(owner.id, { ...owner, runId });
    startRun(runId, start);

    return entry;
  }

  /** The files changed in the run's latest implementation attempt. */
  function changedFiles(entry: RunRecord) {
    const lastRetry = entry.events.findLastIndex(
      (event) => event.type === 'retry.scheduled',
    );
    const changes = new Map<string, DiffFile>();

    for (const event of entry.events.slice(lastRetry + 1)) {
      if (event.type !== 'file.changed') continue;
      const known = patches[event.path];
      changes.set(event.path, {
        path: event.path,
        previousPath: known?.previousPath ?? null,
        change: event.change,
        additions: event.additions,
        deletions: event.deletions,
        language: known?.language ?? null,
        patch: known?.patch ?? '',
        explanation: known?.explanation ?? null,
      });
    }

    return [...changes.values()];
  }

  const isFinished = (run: Run) =>
    run.status === 'completed' || run.status === 'cancelled';

  const slugify = (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'organization';

  /** Drops the scoping field before a record leaves the API. */
  const withoutScope = <T extends { organizationId: string }>(item: T) => {
    const copy: Partial<T> = { ...item };
    delete copy.organizationId;
    return copy as Omit<T, 'organizationId'>;
  };

  const store = {
    options: { speed, apiOrigin, webOrigin },
    now,
    nextId,
    data,

    /* Sessions */

    sessionFor(token: string | undefined): Session {
      if (!token) throw unauthorized('signed_out');
      const session = data.sessions.get(token);
      if (!session) throw unauthorized('signed_out');
      if (session.expiresAt.getTime() <= now().getTime())
        throw unauthorized('expired');

      const user = must(data.users.get(session.userId), 'User', session.userId);
      const membership = membershipOf(user.id);

      return {
        user,
        organizationId: membership?.organizationId ?? null,
        role: membership?.role ?? null,
        expiresAt: session.expiresAt.toISOString(),
      };
    },
    signOut(token: string | undefined) {
      if (token) data.sessions.delete(token);
    },
    startSignIn(next: string | null) {
      const state = nextId('state');
      data.pendingStates.set(state, { kind: 'sign-in', next });
      return {
        url: `${apiOrigin}/auth/github/authorize?state=${state}`,
        state,
      };
    },
    /** Who the simulated GitHub page can sign in as. */
    signInChoices(state: string) {
      const pending = data.pendingStates.get(state);
      if (pending?.kind !== 'sign-in')
        throw new ApiFailure('invalid', 'Unknown sign-in state');
      return [...data.githubAccounts.entries()].map(([userId, account]) => ({
        user: must(data.users.get(userId), 'User', userId),
        account,
        isNew: membershipOf(userId) === null,
      }));
    },
    issueCode(state: string, userId: string) {
      const pending = data.pendingStates.get(state);
      if (pending?.kind !== 'sign-in')
        throw new ApiFailure('invalid', 'Unknown sign-in state');
      must(data.githubAccounts.get(userId), 'GitHub account for', userId);
      const code = nextId('code');
      data.codes.set(code, { userId, state });
      return code;
    },
    completeSignIn(code: string, state: string) {
      const issued = data.codes.get(code);
      const pending = data.pendingStates.get(state);
      if (!issued || issued.state !== state || pending?.kind !== 'sign-in') {
        throw new ApiFailure(
          'invalid',
          'The sign-in could not be completed. Try again.',
        );
      }
      data.codes.delete(code);
      data.pendingStates.delete(state);

      const token = `session-${crypto.randomUUID()}`;
      data.sessions.set(token, {
        userId: issued.userId,
        expiresAt: new Date(now().getTime() + SESSION_DAYS * DAY),
      });

      return { token, session: store.sessionFor(token), next: pending.next };
    },

    /* Organizations and the GitHub App */

    organization(orgId: string): Organization {
      return must(data.organizations.get(orgId), 'Organization', orgId);
    },
    members: (orgId: string) => data.memberships.get(orgId) ?? [],
    inviteMember(session: Session, input: InviteMember): Member {
      const organizationId = requireOrg(session);
      requireRole(session, ['owner', 'admin']);
      if (input.role === 'owner' && session.role !== 'owner') {
        throw new ApiFailure('forbidden', 'Only an owner can add an owner');
      }
      const members = data.memberships.get(organizationId) ?? [];
      const existing = [...data.users.values()].find(
        (user) => user.email.toLowerCase() === input.email.toLowerCase(),
      );
      if (
        existing &&
        members.some((member) => member.user.id === existing.id)
      ) {
        throw new ApiFailure('conflict', `${input.email} is already a member`);
      }
      const user: User = existing ?? {
        id: nextId('user'),
        email: input.email,
        name: input.name,
        avatarUrl: null,
        githubLogin: null,
        createdAt: now().toISOString(),
      };
      data.users.set(user.id, user);
      const member: Member = {
        user,
        role: input.role,
        joinedAt: now().toISOString(),
      };
      data.memberships.set(organizationId, [...members, member]);
      audit(organizationId, session.user, 'member.invited', {
        type: 'user',
        id: user.id,
        label: user.name,
      });
      return member;
    },
    updateMemberRole(session: Session, userId: string, role: Role): Member {
      const organizationId = requireOrg(session);
      requireRole(session, ['owner', 'admin']);
      const members = data.memberships.get(organizationId) ?? [];
      const current = members.find((member) => member.user.id === userId);
      if (!current) throw new ApiFailure('not_found', 'No such member');
      if (
        (current.role === 'owner' || role === 'owner') &&
        session.role !== 'owner'
      ) {
        throw new ApiFailure(
          'forbidden',
          'Only an owner can change who owns the organization',
        );
      }
      if (
        current.role === 'owner' &&
        role !== 'owner' &&
        members.filter((member) => member.role === 'owner').length === 1
      ) {
        throw new ApiFailure(
          'conflict',
          'The organization needs at least one owner',
        );
      }
      const updated: Member = { ...current, role };
      data.memberships.set(
        organizationId,
        members.map((member) => (member.user.id === userId ? updated : member)),
      );
      audit(organizationId, session.user, 'member.role_changed', {
        type: 'user',
        id: userId,
        label: `${current.user.name}: ${role}`,
      });
      return updated;
    },
    removeMember(session: Session, userId: string) {
      const organizationId = requireOrg(session);
      requireRole(session, ['owner', 'admin']);
      const members = data.memberships.get(organizationId) ?? [];
      const current = members.find((member) => member.user.id === userId);
      if (!current) throw new ApiFailure('not_found', 'No such member');
      if (current.role === 'owner' && session.role !== 'owner') {
        throw new ApiFailure('forbidden', 'Only an owner can remove an owner');
      }
      if (
        current.role === 'owner' &&
        members.filter((member) => member.role === 'owner').length === 1
      ) {
        throw new ApiFailure(
          'conflict',
          'The organization needs at least one owner',
        );
      }
      data.memberships.set(
        organizationId,
        members.filter((member) => member.user.id !== userId),
      );
      // Their sessions stop working at once.
      for (const [token, held] of data.sessions) {
        if (held.userId === userId) data.sessions.delete(token);
      }
      audit(organizationId, session.user, 'member.removed', {
        type: 'user',
        id: userId,
        label: current.user.name,
      });
    },
    createOrganization(session: Session, name: string): Organization {
      if (session.organizationId) {
        throw new ApiFailure(
          'conflict',
          'You already belong to an organization',
        );
      }
      const id = nextId('org');
      const organization: Organization = {
        id,
        name,
        slug: slugify(name),
        plan: 'free',
        createdAt: now().toISOString(),
      };
      data.organizations.set(id, organization);
      data.memberships.set(id, [
        { user: session.user, role: 'owner', joinedAt: organization.createdAt },
      ]);
      audit(id, session.user, 'organization.created', {
        type: 'organization',
        id,
        label: name,
      });

      return organization;
    },
    installation: (orgId: string) => data.installations.get(orgId) ?? null,
    startInstall(session: Session) {
      const organizationId = requireOrg(session);
      requireRole(session, ['owner', 'admin']);
      const state = nextId('state');
      data.pendingStates.set(state, {
        kind: 'install',
        userId: session.user.id,
        organizationId,
      });
      return { url: `${apiOrigin}/auth/github/install?state=${state}`, state };
    },
    installChoice(state: string) {
      const pending = data.pendingStates.get(state);
      if (pending?.kind !== 'install')
        throw new ApiFailure('invalid', 'Unknown install state');
      const account = must(
        data.githubAccounts.get(pending.userId),
        'GitHub account for',
        pending.userId,
      );
      const organization = store.organization(pending.organizationId);
      return { account, organization, permissions: APP_PERMISSIONS };
    },
    completeInstall(
      session: Session,
      installationId: string,
      state: string,
    ): Installation {
      const organizationId = requireOrg(session);
      const pending = data.pendingStates.get(state);
      if (
        pending?.kind !== 'install' ||
        pending.organizationId !== organizationId ||
        pending.userId !== session.user.id
      ) {
        throw new ApiFailure(
          'invalid',
          'The installation could not be completed. Try again.',
        );
      }
      data.pendingStates.delete(state);
      const account = must(
        data.githubAccounts.get(session.user.id),
        'GitHub account for',
        session.user.id,
      );

      const installation: Installation = {
        id: installationId,
        accountLogin: account.login,
        accountType: account.type,
        repositorySelection: 'selected',
        permissions: APP_PERMISSIONS,
        installedAt: now().toISOString(),
      };
      data.installations.set(organizationId, installation);
      audit(organizationId, session.user, 'github_app.installed', {
        type: 'installation',
        id: installationId,
        label: account.login,
      });

      return installation;
    },
    githubRepositories(session: Session): GitHubRepository[] {
      const organizationId = requireOrg(session);
      if (!data.installations.get(organizationId)) {
        throw new ApiFailure('conflict', 'Install the GitHub App first');
      }
      const account = must(
        data.githubAccounts.get(session.user.id),
        'GitHub account for',
        session.user.id,
      );
      const connected = [...data.repositories.values()].filter(
        (repo) =>
          repo.organizationId === organizationId && repo.status !== 'revoked',
      );

      return account.repositories.map(
        ({
          githubId,
          fullName,
          private: isPrivate,
          defaultBranch,
          description,
          pushedAt,
        }) => ({
          githubId,
          fullName,
          private: isPrivate,
          defaultBranch,
          description,
          pushedAt,
          connectedRepositoryId:
            connected.find((item) => item.githubId === githubId)?.id ?? null,
        }),
      );
    },

    /* Repositories */

    repositories: (orgId: string) =>
      [...data.repositories.values()]
        .filter((repo) => repo.organizationId === orgId)
        .sort((a, b) => b.pushedAt.localeCompare(a.pushedAt)),
    repository,
    analysis(orgId: string, repoId: string) {
      repository(orgId, repoId);
      return must(data.analyses.get(repoId), 'Analysis for repository', repoId);
    },
    connectRepository(session: Session, input: ConnectRepository): Repository {
      const organizationId = requireOrg(session);
      requireRole(session, ['owner', 'admin', 'developer']);
      const existing = [...data.repositories.values()].find(
        (repo) =>
          repo.organizationId === organizationId &&
          repo.githubId === input.githubId &&
          repo.status !== 'revoked',
      );
      if (existing) {
        throw new ApiFailure(
          'conflict',
          `${input.fullName} is already connected`,
        );
      }

      const source = data.githubAccounts
        .get(session.user.id)
        ?.repositories.find((repo) => repo.githubId === input.githubId);
      const id = nextId('repo');
      const at = now().toISOString();
      const repo: Repository = {
        id,
        organizationId,
        githubId: input.githubId,
        fullName: input.fullName,
        defaultBranch: source?.defaultBranch ?? 'main',
        private: source?.private ?? false,
        url: `https://github.com/${input.fullName}`,
        status: 'analyzing',
        statusMessage: 'Indexing the repository',
        languages: [],
        lastAnalyzedCommit: null,
        lastAnalyzedAt: null,
        openFindings: 0,
        latestTaskId: null,
        pushedAt: source?.pushedAt ?? at,
        connectedAt: at,
      };
      data.repositories.set(id, repo);
      audit(organizationId, session.user, 'repository.connected', {
        type: 'repository',
        id,
        label: input.fullName,
      });

      const finish = () => {
        const current = data.repositories.get(id);
        if (!current || current.status !== 'analyzing') return;
        const commit = 'a1b2c3d';
        data.repositories.set(id, {
          ...current,
          status: 'connected',
          statusMessage: null,
          languages: source?.languages ?? [
            { name: 'TypeScript', share: 0.92 },
            { name: 'CSS', share: 0.08 },
          ],
          lastAnalyzedCommit: commit,
          lastAnalyzedAt: now().toISOString(),
        });
        data.analyses.set(
          id,
          seedStore.analysisFor(id, commit, now().toISOString()),
        );
      };

      if (speed === Infinity) finish();
      else {
        const timer = setTimeout(finish, ANALYSIS_MS / speed);
        timer.unref?.();
      }

      return repository(organizationId, id);
    },
    disconnectRepository(session: Session, repoId: string) {
      const organizationId = requireOrg(session);
      requireRole(session, ['owner', 'admin']);
      const repo = repository(organizationId, repoId);
      data.repositories.set(repoId, {
        ...repo,
        status: 'revoked',
        statusMessage: 'Access revoked',
      });
      audit(organizationId, session.user, 'repository.revoked', {
        type: 'repository',
        id: repoId,
        label: repo.fullName,
      });
    },

    /* Tasks and runs */

    tasks(orgId: string, filter: TaskQuery = {}) {
      return [...data.tasks.values()]
        .filter((item) => item.organizationId === orgId)
        .filter(
          (item) =>
            !filter.repositoryId || item.repositoryId === filter.repositoryId,
        )
        .filter((item) => !filter.status || item.status === filter.status)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    task,
    createTask(session: Session, input: CreateTask): Task {
      const organizationId = requireOrg(session);
      requireRole(session, ['owner', 'admin', 'developer']);
      const repo = repository(organizationId, input.repositoryId);
      if (repo.status === 'revoked') {
        throw new ApiFailure(
          'conflict',
          `${repo.fullName} is no longer connected`,
        );
      }

      const id = nextId('task');
      const at = now().toISOString();
      const created: Task = {
        id,
        organizationId,
        repositoryId: repo.id,
        title: input.title,
        request: input.request,
        category: input.category,
        baseCommit: repo.lastAnalyzedCommit ?? 'a1b2c3d',
        branch: null,
        status: 'queued',
        decision: null,
        runId: '',
        budget: {
          maxMinutes: 60,
          maxRetries: 2,
          maxTokens: 400_000,
          ...input.budget,
        },
        createdBy: session.user.id,
        createdAt: at,
        updatedAt: at,
      };
      data.tasks.set(id, created);
      data.repositories.set(repo.id, { ...repo, latestTaskId: id });
      audit(organizationId, session.user, 'task.created', {
        type: 'task',
        id,
        label: input.title,
      });

      createRun(created, scenarioForTask(input.category, input.title), {
        startedAt: now(),
        elapsedMs: 0,
      });

      return task(organizationId, id);
    },
    cancelTask(session: Session, taskId: string): Task {
      const organizationId = requireOrg(session);
      requireRole(session, ['owner', 'admin', 'developer']);
      const current = task(organizationId, taskId);
      const entry = record(organizationId, current.runId);
      if (isFinished(entry.run)) {
        throw new ApiFailure('conflict', 'The task has already finished');
      }

      entry.player?.stop();
      emit(current.runId, {
        type: 'run.finished',
        status: 'cancelled',
        error: null,
      });
      audit(organizationId, session.user, 'task.cancelled', {
        type: 'task',
        id: taskId,
        label: current.title,
      });

      return task(organizationId, taskId);
    },
    decide(
      session: Session,
      taskId: string,
      decision: Exclude<Decision, 'revision_requested'>,
    ): Task {
      const organizationId = requireOrg(session);
      requireRole(session, ['owner', 'admin', 'developer', 'reviewer']);
      const current = task(organizationId, taskId);
      const entry = record(organizationId, current.runId);
      if (entry.run.status !== 'awaiting_approval') {
        throw new ApiFailure('conflict', 'The task is not awaiting approval');
      }

      const summary =
        decision === 'approved'
          ? `Approved by ${session.user.name}`
          : `Rejected by ${session.user.name}`;
      emit(current.runId, {
        type: 'stage.finished',
        stage: 'approval',
        attempt: 1,
        status: 'passed',
        summary,
        failureReason: null,
      });
      emit(current.runId, {
        type: 'run.finished',
        status: 'completed',
        error: null,
      });
      data.tasks.set(taskId, {
        ...task(organizationId, taskId),
        decision,
        status: 'completed',
      });
      audit(organizationId, session.user, `task.${decision}`, {
        type: 'task',
        id: taskId,
        label: current.title,
      });

      return task(organizationId, taskId);
    },
    requestRevision(
      session: Session,
      taskId: string,
      instructions: string,
    ): Task {
      const organizationId = requireOrg(session);
      requireRole(session, ['owner', 'admin', 'developer', 'reviewer']);
      const current = task(organizationId, taskId);
      const entry = record(organizationId, current.runId);
      if (entry.run.status !== 'awaiting_approval') {
        throw new ApiFailure('conflict', 'The task is not awaiting approval');
      }

      emit(current.runId, {
        type: 'stage.finished',
        stage: 'approval',
        attempt: 1,
        status: 'passed',
        summary: `Revision requested: ${instructions}`,
        failureReason: null,
      });
      emit(current.runId, {
        type: 'run.finished',
        status: 'completed',
        error: null,
      });

      const revised: Task = {
        ...task(organizationId, taskId),
        decision: 'revision_requested',
        request: `${current.request}\n\nRevision: ${instructions}`,
        status: 'queued',
      };
      data.tasks.set(taskId, revised);
      audit(organizationId, session.user, 'task.revision_requested', {
        type: 'task',
        id: taskId,
        label: current.title,
      });
      createRun(revised, 'happy', { startedAt: now(), elapsedMs: 0 });

      return task(organizationId, taskId);
    },
    openPullRequest(session: Session, taskId: string): PullRequest {
      const organizationId = requireOrg(session);
      requireRole(session, ['owner', 'admin', 'developer']);
      const current = task(organizationId, taskId);
      if (current.decision !== 'approved') {
        throw new ApiFailure(
          'conflict',
          'Only approved tasks can open a pull request',
        );
      }
      const existing = [...data.pullRequests.values()].find(
        (pr) => pr.taskId === taskId,
      );
      if (existing)
        throw new ApiFailure('conflict', 'A pull request is already open');

      const repo = repository(organizationId, current.repositoryId);
      const id = nextId('pr');
      const number = 100 + data.pullRequests.size + 1;
      const pr: PullRequest = {
        id,
        taskId,
        runId: current.runId,
        repositoryId: repo.id,
        number,
        url: `https://github.com/${repo.fullName}/pull/${number}`,
        title: current.title,
        branch: current.branch ?? `forgemind/${taskId}`,
        state: 'open',
        reviewStatus: 'pending',
        checksStatus: 'pending',
        createdAt: now().toISOString(),
        mergedAt: null,
      };
      data.pullRequests.set(id, pr);
      audit(organizationId, session.user, 'pull_request.opened', {
        type: 'pull_request',
        id,
        label: `#${number} ${pr.title}`,
      });
      notify(organizationId, {
        kind: 'pull_request_updated',
        title: `Pull request #${number} opened`,
        body: `${repo.fullName}: ${pr.title}`,
        href: `/pull-requests`,
      });

      return pr;
    },
    runs(orgId: string, filter: RunQuery = {}): Run[] {
      return [...data.runs.values()]
        .map((entry) => entry.run)
        .filter((run) => data.tasks.get(run.taskId)?.organizationId === orgId)
        .filter((run) => !filter.taskId || run.taskId === filter.taskId)
        .filter(
          (run) =>
            !filter.repositoryId ||
            data.tasks.get(run.taskId)?.repositoryId === filter.repositoryId,
        )
        .filter((run) => !filter.status || run.status === filter.status)
        .filter((run) => !filter.outcome || run.outcome === filter.outcome)
        .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
    },
    taskRuns(orgId: string, taskId: string): Run[] {
      task(orgId, taskId);
      return [...data.runs.values()]
        .filter((entry) => entry.run.taskId === taskId)
        .map((entry) => entry.run);
    },

    run: (orgId: string, runId: string) => record(orgId, runId).run,
    isFinished: (runId: string) =>
      isFinished(must(data.runs.get(runId), 'Run', runId).run),
    eventsAfter: (orgId: string, runId: string, after: number) =>
      record(orgId, runId).events.filter((event) => event.seq > after),
    subscribe(runId: string, listener: (event: Event) => void) {
      must(data.runs.get(runId), 'Run', runId);
      const set = listeners.get(runId) ?? new Set();
      set.add(listener);
      listeners.set(runId, set);
      return () => {
        set.delete(listener);
      };
    },
    runDiff(orgId: string, runId: string): RunDiff {
      const entry = record(orgId, runId);
      return {
        runId,
        baseCommit: entry.run.baseCommit,
        headCommit: entry.run.diff
          ? `${entry.run.baseCommit.slice(0, 4)}f00d`
          : null,
        files: changedFiles(entry),
      };
    },
    report(orgId: string, runId: string): Report {
      const entry = record(orgId, runId);
      const { run, events } = entry;
      if (!run.outcome) {
        throw new ApiFailure(
          'conflict',
          'The report is available once the run finishes',
        );
      }

      const owner = task(orgId, run.taskId);
      const repo = repository(orgId, owner.repositoryId);
      const notes = (agent: string) =>
        events
          .filter(
            (event) => event.type === 'agent.note' && event.agent === agent,
          )
          .map((event) => (event.type === 'agent.note' ? event.text : ''));
      const architect = notes('architect');
      const unresolved = [
        // A stage that ended failed, with no later attempt that passed.
        ...run.stages
          .filter((stage) => stage.status === 'failed')
          .flatMap((stage) => {
            const last = stage.attempts.at(-1);
            return last?.failureReason
              ? [`${stage.id} failed: ${last.failureReason}`]
              : [];
          }),
        ...(run.review?.concerns ?? []),
        ...run.checks
          .filter((check) => check.required && check.status !== 'passed')
          .map(
            (check) =>
              `${check.label} did not pass (${check.status.replace('_', ' ')})`,
          ),
        ...(run.error ? [run.error] : []),
      ];

      return {
        runId,
        taskId: owner.id,
        repositoryId: repo.id,
        repositoryFullName: repo.fullName,
        commit: run.baseCommit,
        task: owner.request,
        investigation: architect[0] ?? 'No investigation notes were recorded.',
        rootCause: architect[0] ?? null,
        filesModified: changedFiles(entry).map((file) => file.path),
        changes:
          notes('developer').join('\n\n') ||
          architect[1] ||
          'No changes were made.',
        commands: events
          .filter((event) => event.type === 'command.started')
          .map((event) =>
            event.type === 'command.started' ? event.command : '',
          ),
        checks: run.checks,
        findings: store
          .findings(orgId, { repositoryId: repo.id })
          .filter((f) => f.runId === runId),
        unresolved,
        outcome: run.outcome,
        generatedAt: now().toISOString(),
      };
    },

    /* The rest */

    findings(orgId: string, filter: FindingQuery = {}) {
      const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      const repos = new Set(store.repositories(orgId).map(({ id }) => id));
      return [...data.findings.values()]
        .filter((item) => repos.has(item.repositoryId))
        .filter(
          (item) =>
            !filter.repositoryId || item.repositoryId === filter.repositoryId,
        )
        .filter((item) => !filter.severity || item.severity === filter.severity)
        .filter((item) => !filter.status || item.status === filter.status)
        .sort((a, b) => order[a.severity] - order[b.severity]);
    },
    pullRequests: (orgId: string) =>
      [...data.pullRequests.values()]
        .filter((pr) => data.tasks.get(pr.taskId)?.organizationId === orgId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    usage(orgId: string): UsageSummary {
      const runs = [...data.runs.values()]
        .filter(
          (entry) => data.tasks.get(entry.run.taskId)?.organizationId === orgId,
        )
        .map((entry) => entry.run);
      const count = (outcome: Run['outcome']) =>
        runs.filter((run) => run.outcome === outcome).length;
      const sandboxSeconds = runs.reduce(
        (sum, run) => sum + run.resources.sandboxSeconds,
        0,
      );
      const cpuSeconds = runs.reduce(
        (sum, run) => sum + run.resources.cpuSeconds,
        0,
      );
      const to = now();
      const from = new Date(to.getTime() - 30 * DAY);

      return {
        period: { from: from.toISOString(), to: to.toISOString() },
        tokens: [
          {
            provider: 'anthropic',
            model: 'claude-opus-5-5',
            input: 412_300 * runs.length,
            output: 38_900 * runs.length,
          },
          {
            provider: 'anthropic',
            model: 'claude-sonnet-5-5',
            input: 905_100 * runs.length,
            output: 61_200 * runs.length,
          },
        ],
        sandboxSeconds,
        cpuSeconds,
        memoryMbHours: Math.round(sandboxSeconds * 0.4),
        runs: {
          total: runs.length,
          succeeded: count('succeeded'),
          partial: count('partial'),
          failed: count('failed'),
          unverified: count('unverified'),
        },
        retryOverheadSeconds: runs.reduce(
          (sum, run) => sum + run.retries.used * 48,
          0,
        ),
        storageBytes: 184_320_000 + runs.length * 2_400_000,
        cost: {
          kind: 'estimate',
          amountUsd: Math.round(runs.length * 3.42 * 100) / 100,
        },
        quotas: {
          concurrentRuns: {
            used: runs.filter((run) => run.status === 'running').length,
            max: 3,
          },
          monthlyRuns: { used: runs.length, max: 200 },
          monthlyTokens: { used: 1_317_400 * runs.length, max: 50_000_000 },
        },
      };
    },
    notifications: (orgId: string): Notification[] =>
      [...data.notifications.values()]
        .filter((note) => note.organizationId === orgId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(withoutScope),
    markNotificationsRead(orgId: string, ids: string[]) {
      const at = now().toISOString();
      for (const id of ids) {
        const note = data.notifications.get(id);
        if (note && note.organizationId === orgId) {
          data.notifications.set(id, { ...note, readAt: note.readAt ?? at });
        }
      }
    },
    audit: (orgId: string): AuditEvent[] =>
      data.audit
        .filter((item) => item.organizationId === orgId)
        .map(withoutScope),

    /* Used by the seed. */
    emit,
    createRun,
    notify,
    recordAudit: audit,
  };

  seedStore(store, options.seed ?? 1);

  // The seed writes some records with fixed ids. Move each counter past them,
  // so nothing created later can take over a seeded record in any tenant.
  const reserve = (prefix: string, ids: Iterable<string>) => {
    for (const id of ids) {
      const match = new RegExp(`^${prefix}-(\\d+)$`).exec(id);
      if (match)
        counters.set(
          prefix,
          Math.max(counters.get(prefix) ?? 0, Number(match[1])),
        );
    }
  };
  reserve('user', data.users.keys());
  reserve('org', data.organizations.keys());
  reserve('repo', data.repositories.keys());
  reserve('pr', data.pullRequests.keys());
  reserve('finding', data.findings.keys());
  reserve(
    'installation',
    [...data.installations.values()].map(({ id }) => id),
  );

  return store;
}

export type Store = ReturnType<typeof createStore>;
export type { Check };
