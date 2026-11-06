import type {
  Finding,
  PullRequest,
  Repository,
  RepositoryAnalysis,
  Task,
  User,
} from '@forgemind/contract';

import type { ScenarioName } from './scenarios';
import { APP_PERMISSIONS, type GitHubAccount, type Store } from './store';

/*
 * Deterministic demo data. Every timestamp is relative to the store's clock,
 * so a fixed clock in tests gives identical data every time.
 */

const MINUTE = 60_000;

function analysisFor(
  repositoryId: string,
  commit: string,
  analyzedAt: string,
): RepositoryAnalysis {
  return {
    repositoryId,
    commit,
    analyzedAt,
    summary:
      'A TypeScript service with a Fastify HTTP layer, a task orchestrator and a worker queue. Tests cover the orchestrator well and the HTTP layer thinly.',
    frameworks: ['Fastify', 'Vitest', 'Drizzle'],
    entryPoints: [
      { path: 'src/server.ts', kind: 'server' },
      { path: 'src/cli.ts', kind: 'cli' },
      { path: 'src/worker.ts', kind: 'worker' },
    ],
    modules: [
      {
        name: 'orchestrator',
        path: 'src/tasks',
        description: 'Plans and runs engineering tasks.',
        importance: 'core',
      },
      {
        name: 'retry',
        path: 'src/retry.ts',
        description: 'Retry budgets for revisions.',
        importance: 'core',
      },
      {
        name: 'http',
        path: 'src/http',
        description: 'Routes and request validation.',
        importance: 'supporting',
      },
      {
        name: 'telemetry',
        path: 'src/telemetry',
        description: 'OpenTelemetry setup.',
        importance: 'peripheral',
      },
    ],
    dependencies: [
      {
        name: 'fastify',
        version: '5.2.1',
        ecosystem: 'npm',
        vulnerable: false,
        advisoryUrl: null,
      },
      {
        name: 'drizzle-orm',
        version: '0.44.0',
        ecosystem: 'npm',
        vulnerable: false,
        advisoryUrl: null,
      },
      {
        name: 'lodash',
        version: '4.17.20',
        ecosystem: 'npm',
        vulnerable: true,
        advisoryUrl: 'https://github.com/advisories/GHSA-35jh-r3h4-6jhm',
      },
      {
        name: 'jsonwebtoken',
        version: '8.5.1',
        ecosystem: 'npm',
        vulnerable: true,
        advisoryUrl: 'https://github.com/advisories/GHSA-8cf7-32gw-wr33',
      },
    ],
    testCommands: ['pnpm test'],
    buildCommands: ['pnpm build'],
    documentation: [
      { path: 'README.md', title: 'Getting started' },
      { path: 'docs/architecture.md', title: 'Architecture' },
    ],
    concerns: [
      {
        title: 'Retry budget resets on every revision',
        detail:
          'The orchestrator rebuilds the retry policy from the plan each revision, so the budget never runs out.',
        evidence: [
          { path: 'src/retry.ts', line: 41 },
          { path: 'src/tasks/run.ts', line: 88 },
        ],
      },
      {
        title: 'Webhook handler has no tests',
        detail:
          'src/http/webhooks.ts verifies signatures and enqueues work, and nothing exercises it.',
        evidence: [{ path: 'src/http/webhooks.ts', line: 1 }],
      },
    ],
  };
}

export function seedStore(store: Store, seed: number) {
  const base = store.now();
  const ago = (minutes: number) => new Date(base.getTime() - minutes * MINUTE);
  const at = (minutes: number) => ago(minutes).toISOString();
  const { data } = store;

  // Seeds can be varied later; today there is one world.
  void seed;

  const user = (
    id: string,
    name: string,
    email: string,
    login: string,
    createdDays: number,
  ): User => ({
    id,
    name,
    email,
    avatarUrl: null,
    githubLogin: login,
    createdAt: at(createdDays * 1440),
  });

  const ayinde = user(
    'user-1',
    'Ayinde',
    'ayindegraphicscreation@gmail.com',
    'Ayindecodes',
    120,
  );
  const mariette = user(
    'user-2',
    'Mariette Talya',
    'mariette@example.com',
    'mtalya',
    90,
  );
  const chidi = user(
    'user-3',
    'Chidi Okafor',
    'chidi@example.com',
    'chidiok',
    45,
  );
  const lena = user(
    'user-4',
    'Lena Fischer',
    'lena@example.com',
    'lfischer',
    12,
  );

  for (const member of [ayinde, mariette, chidi, lena])
    data.users.set(member.id, member);

  // Sam has a GitHub account and nothing else yet: the new-user path.
  const sam = user('user-5', 'Sam Rivera', 'sam@example.com', 'samrivera', 0);
  data.users.set(sam.id, sam);

  data.organizations.set('org-1', {
    id: 'org-1',
    name: 'Ayinde Creations',
    slug: 'ayinde-creations',
    plan: 'team',
    createdAt: at(120 * 1440),
  });
  data.memberships.set('org-1', [
    { user: ayinde, role: 'owner', joinedAt: ayinde.createdAt },
    { user: mariette, role: 'admin', joinedAt: mariette.createdAt },
    { user: chidi, role: 'developer', joinedAt: chidi.createdAt },
    { user: lena, role: 'reviewer', joinedAt: lena.createdAt },
  ]);

  // Fixed tokens for development and tests. A real API never has these.
  const farAhead = new Date(base.getTime() + 365 * 1440 * MINUTE);
  data.sessions.set('dev-owner', { userId: ayinde.id, expiresAt: farAhead });
  data.sessions.set('dev-new', { userId: sam.id, expiresAt: farAhead });
  data.sessions.set('dev-expired', { userId: ayinde.id, expiresAt: ago(1440) });

  data.installations.set('org-1', {
    id: 'installation-1',
    accountLogin: 'forgemind',
    accountType: 'organization',
    repositorySelection: 'selected',
    permissions: APP_PERMISSIONS,
    installedAt: at(30 * 1440),
  });

  const repo = (
    id: string,
    fullName: string,
    githubId: number,
    languages: Repository['languages'],
    extra: Partial<Repository> = {},
  ): Repository => ({
    id,
    organizationId: 'org-1',
    githubId,
    fullName,
    defaultBranch: 'main',
    private: true,
    url: `https://github.com/${fullName}`,
    status: 'connected',
    statusMessage: null,
    languages,
    lastAnalyzedCommit: 'c0ffee1',
    lastAnalyzedAt: at(40),
    openFindings: 0,
    latestTaskId: null,
    pushedAt: at(25),
    connectedAt: at(30 * 1440),
    ...extra,
  });

  const repositories = [
    repo(
      'repo-1',
      'forgemind/api',
      811001,
      [
        { name: 'TypeScript', share: 0.88 },
        { name: 'SQL', share: 0.07 },
        { name: 'Shell', share: 0.05 },
      ],
      { openFindings: 3 },
    ),
    repo(
      'repo-2',
      'forgemind/web',
      811002,
      [
        { name: 'TypeScript', share: 0.94 },
        { name: 'CSS', share: 0.06 },
      ],
      {
        private: false,
        pushedAt: at(90),
        lastAnalyzedCommit: 'b1bb32f',
        openFindings: 1,
      },
    ),
    repo(
      'repo-3',
      'forgemind/workers',
      811003,
      [
        { name: 'Python', share: 0.76 },
        { name: 'Dockerfile', share: 0.14 },
        { name: 'Shell', share: 0.1 },
      ],
      { pushedAt: at(300), lastAnalyzedCommit: '9e8d7c6', openFindings: 2 },
    ),
    repo(
      'repo-4',
      'acme/payments',
      811004,
      [
        { name: 'Go', share: 0.81 },
        { name: 'HCL', share: 0.19 },
      ],
      {
        status: 'error',
        statusMessage:
          'The GitHub App installation was suspended by the organization owner.',
        lastAnalyzedCommit: '5a4b3c2',
        lastAnalyzedAt: at(3 * 1440),
        pushedAt: at(2 * 1440),
        openFindings: 4,
      },
    ),
    repo(
      'repo-5',
      'acme/legacy-portal',
      811005,
      [
        { name: 'PHP', share: 0.9 },
        { name: 'JavaScript', share: 0.1 },
      ],
      {
        status: 'revoked',
        statusMessage: 'Access revoked',
        lastAnalyzedCommit: null,
        lastAnalyzedAt: null,
        pushedAt: at(60 * 1440),
      },
    ),
  ];
  for (const item of repositories) data.repositories.set(item.id, item);
  for (const item of repositories.slice(0, 4)) {
    data.analyses.set(
      item.id,
      analysisFor(
        item.id,
        item.lastAnalyzedCommit ?? 'c0ffee1',
        item.lastAnalyzedAt ?? at(40),
      ),
    );
  }

  const gh = (
    githubId: number,
    fullName: string,
    description: string,
    languages: Repository['languages'],
    pushedMinutesAgo: number,
    isPrivate = true,
  ): GitHubAccount['repositories'][number] => ({
    githubId,
    fullName,
    private: isPrivate,
    defaultBranch: 'main',
    description,
    pushedAt: at(pushedMinutesAgo),
    languages,
  });
  data.githubAccounts.set(ayinde.id, {
    login: 'forgemind',
    type: 'organization',
    repositories: [
      ...repositories
        .filter(
          (repo) =>
            repo.fullName.startsWith('forgemind/') ||
            repo.fullName.startsWith('acme/'),
        )
        .map((repo) =>
          gh(
            repo.githubId,
            repo.fullName,
            `${repo.fullName.split('/')[1]} service`,
            repo.languages,
            25,
            repo.private,
          ),
        ),
      gh(
        811006,
        'forgemind/docs',
        'Product documentation',
        [
          { name: 'MDX', share: 0.9 },
          { name: 'TypeScript', share: 0.1 },
        ],
        600,
        false,
      ),
      gh(
        811007,
        'forgemind/infra',
        'Terraform and deployment scripts',
        [
          { name: 'HCL', share: 0.8 },
          { name: 'Shell', share: 0.2 },
        ],
        3000,
      ),
    ],
  });
  data.githubAccounts.set(sam.id, {
    login: 'samrivera',
    type: 'user',
    repositories: [
      gh(
        920001,
        'samrivera/notes-api',
        'A small notes service with a flaky test suite',
        [
          { name: 'TypeScript', share: 0.95 },
          { name: 'SQL', share: 0.05 },
        ],
        90,
      ),
      gh(
        920002,
        'samrivera/shop-web',
        'Storefront built with Next.js',
        [
          { name: 'TypeScript', share: 0.8 },
          { name: 'CSS', share: 0.2 },
        ],
        400,
        false,
      ),
      gh(
        920003,
        'samrivera/data-pipeline',
        'Nightly ETL jobs',
        [
          { name: 'Python', share: 0.97 },
          { name: 'Shell', share: 0.03 },
        ],
        2000,
      ),
      gh(
        920004,
        'samrivera/dotfiles',
        'Editor and shell configuration',
        [
          { name: 'Shell', share: 0.7 },
          { name: 'Lua', share: 0.3 },
        ],
        9000,
        false,
      ),
      gh(
        920005,
        'samrivera/legacy-cms',
        'An old PHP site, kept alive',
        [
          { name: 'PHP', share: 0.9 },
          { name: 'JavaScript', share: 0.1 },
        ],
        30000,
      ),
    ],
  });

  type TaskSeed = {
    repo: string;
    title: string;
    request: string;
    category: Task['category'];
    scenario: ScenarioName;
    startedMinutesAgo: number;
    /** How much of the run has played. Omit for all of it. */
    elapsedMs?: number;
    delayMs?: number;
    cutoffMs?: number;
    decision?: Task['decision'];
    createdBy?: User;
    cancelled?: boolean;
  };

  const seeds: TaskSeed[] = [
    {
      repo: 'repo-1',
      title: 'Investigate the failing build',
      request:
        'The main branch build has failed three times since yesterday with a retry budget error. Find the cause and fix it.',
      category: 'fix_bug',
      scenario: 'retry-then-unverified',
      startedMinutesAgo: 0.5,
      elapsedMs: 30_000,
    },
    {
      repo: 'repo-1',
      title: 'Fix retry budget overflow',
      request:
        'Revisions keep retrying past the budget the task allows. Stop that and add a regression test.',
      category: 'fix_bug',
      scenario: 'happy',
      startedMinutesAgo: 130,
    },
    {
      repo: 'repo-1',
      title: 'Add tests for the webhook handler',
      request:
        'src/http/webhooks.ts has no tests. Cover signature verification and the enqueue path.',
      category: 'add_tests',
      scenario: 'partial',
      startedMinutesAgo: 300,
      createdBy: chidi,
    },
    {
      repo: 'repo-1',
      title: 'Upgrade vulnerable dependencies',
      request:
        'lodash and jsonwebtoken have open advisories. Upgrade them and make sure nothing breaks.',
      category: 'dependencies',
      scenario: 'retry-then-unverified',
      startedMinutesAgo: 1440,
      decision: 'rejected',
    },
    {
      repo: 'repo-3',
      title: 'Trace the timeout in the sandbox runner',
      request:
        'Runs on the workers time out after 20 minutes even when the job is idle. Find out why.',
      category: 'fix_bug',
      scenario: 'failed',
      startedMinutesAgo: 2 * 1440,
      createdBy: mariette,
    },
    {
      repo: 'repo-1',
      title: 'Explain how the plan cache is invalidated',
      request:
        'Document when the plan cache is cleared and whether a stale plan can be reused across repositories.',
      category: 'investigate',
      scenario: 'investigation',
      startedMinutesAgo: 3 * 1440,
      createdBy: lena,
    },
    {
      repo: 'repo-1',
      title: 'Validate input on the tasks endpoint',
      request:
        'POST /tasks accepts any JSON. Validate the body and return clear errors.',
      category: 'validation',
      scenario: 'happy',
      startedMinutesAgo: 4 * 1440,
      decision: 'approved',
    },
    {
      repo: 'repo-2',
      title: 'Reduce duplication in the parser',
      request:
        'The three tokenizer passes in src/parser share most of their code. Consolidate them without changing output.',
      category: 'refactor',
      scenario: 'happy',
      startedMinutesAgo: 6 * 1440,
      decision: 'approved',
      createdBy: chidi,
    },
    {
      repo: 'repo-2',
      title: 'Document the release process',
      request:
        'Write docs/releasing.md from the scripts in package.json and the GitHub workflow.',
      category: 'docs',
      scenario: 'happy',
      startedMinutesAgo: 8 * 1440,
      decision: 'approved',
    },
    {
      repo: 'repo-2',
      title: 'Investigate the flaky webhook test',
      request:
        'tests/webhooks.test.ts fails about once in ten runs. Find out whether the test or the handler is at fault.',
      category: 'investigate',
      scenario: 'investigation',
      startedMinutesAgo: 0,
      delayMs: 45_000,
    },
    {
      repo: 'repo-3',
      title: 'Rotate the exposed credential in the config loader',
      request:
        'config/loader.py logs the full database URL at startup. Stop logging it and rotate the credential.',
      category: 'security',
      scenario: 'happy',
      startedMinutesAgo: 1440 + 60,
      createdBy: mariette,
    },
    {
      repo: 'repo-1',
      title: 'Fix pagination off-by-one',
      request:
        'The last item of every page is repeated as the first item of the next.',
      category: 'fix_bug',
      scenario: 'happy',
      startedMinutesAgo: 5 * 1440,
      cutoffMs: 40_000,
      cancelled: true,
    },
  ];

  for (const item of seeds) {
    const id = store.nextId('task');
    const createdBy = item.createdBy ?? ayinde;
    const startedAt = ago(item.startedMinutesAgo);
    const created: Task = {
      id,
      organizationId: 'org-1',
      repositoryId: item.repo,
      title: item.title,
      request: item.request,
      category: item.category,
      baseCommit:
        data.repositories.get(item.repo)?.lastAnalyzedCommit ?? 'c0ffee1',
      branch: null,
      status: 'queued',
      decision: null,
      runId: '',
      budget: { maxMinutes: 60, maxRetries: 2, maxTokens: 400_000 },
      createdBy: createdBy.id,
      createdAt: startedAt.toISOString(),
      updatedAt: startedAt.toISOString(),
    };
    data.tasks.set(id, created);
    data.repositories.set(item.repo, {
      ...data.repositories.get(item.repo)!,
      latestTaskId: id,
    });
    store.recordAudit('org-1', createdBy, 'task.created', {
      type: 'task',
      id,
      label: item.title,
    });

    const entry = store.createRun(created, item.scenario, {
      startedAt,
      elapsedMs:
        item.delayMs === undefined
          ? (item.elapsedMs ?? Number.POSITIVE_INFINITY)
          : undefined,
      delayMs: item.delayMs,
      cutoffMs: item.cutoffMs,
    });

    const finishedAt =
      entry.run.finishedAt ??
      entry.events.at(-1)?.at ??
      startedAt.toISOString();
    const later = (minutes: number) =>
      new Date(new Date(finishedAt).getTime() + minutes * MINUTE);

    if (item.cancelled) {
      entry.player?.stop();
      store.emit(
        entry.run.id,
        { type: 'run.finished', status: 'cancelled', error: null },
        later(1),
      );
      store.recordAudit('org-1', createdBy, 'task.cancelled', {
        type: 'task',
        id,
        label: item.title,
      });
    }

    if (item.decision && entry.run.status === 'awaiting_approval') {
      const actor = item.decision === 'approved' ? lena : ayinde;
      store.emit(
        entry.run.id,
        {
          type: 'stage.finished',
          stage: 'approval',
          attempt: 1,
          status: 'passed',
          summary: `${item.decision === 'approved' ? 'Approved' : 'Rejected'} by ${actor.name}`,
          failureReason: null,
        },
        later(35),
      );
      store.emit(
        entry.run.id,
        { type: 'run.finished', status: 'completed', error: null },
        later(35),
      );
      data.tasks.set(id, {
        ...data.tasks.get(id)!,
        decision: item.decision,
        status: 'completed',
        updatedAt: later(35).toISOString(),
      });
      store.recordAudit('org-1', actor, `task.${item.decision}`, {
        type: 'task',
        id,
        label: item.title,
      });
    }
  }

  const pr = (
    id: string,
    taskId: string,
    number: number,
    extra: Partial<PullRequest>,
  ): PullRequest => {
    const owner = data.tasks.get(taskId)!;
    const repository = data.repositories.get(owner.repositoryId)!;
    return {
      id,
      taskId,
      runId: owner.runId,
      repositoryId: repository.id,
      number,
      url: `https://github.com/${repository.fullName}/pull/${number}`,
      title: owner.title,
      branch: owner.branch ?? `forgemind/${taskId}`,
      state: 'open',
      reviewStatus: 'pending',
      checksStatus: 'pending',
      createdAt: owner.updatedAt,
      mergedAt: null,
      ...extra,
    };
  };
  for (const item of [
    pr('pr-1', 'task-7', 118, {
      state: 'merged',
      reviewStatus: 'approved',
      checksStatus: 'passed',
      mergedAt: at(3 * 1440 + 300),
    }),
    pr('pr-2', 'task-8', 121, {
      reviewStatus: 'approved',
      checksStatus: 'passed',
    }),
    pr('pr-3', 'task-9', 124, {
      reviewStatus: 'changes_requested',
      checksStatus: 'failed',
    }),
  ]) {
    data.pullRequests.set(item.id, item);
  }

  type FindingSeed = Omit<
    Finding,
    'id' | 'repositoryId' | 'status' | 'detectedAt' | 'runId'
  > &
    Partial<Pick<Finding, 'status' | 'detectedAt' | 'runId'>>;
  const finding = (
    id: string,
    repositoryId: string,
    partial: FindingSeed,
  ): Finding => ({
    id,
    repositoryId,
    status: 'open',
    detectedAt: at(40),
    runId: null,
    ...partial,
  });
  const findings: Finding[] = [
    finding('finding-1', 'repo-1', {
      title: 'lodash 4.17.20 has a prototype pollution advisory',
      severity: 'high',
      confidence: 'confirmed',
      category: 'vulnerable_dependency',
      location: { path: 'package.json', line: 24 },
      evidence:
        'GHSA-35jh-r3h4-6jhm affects lodash < 4.17.21; the lockfile resolves 4.17.20.',
      remediation: 'Upgrade lodash to 4.17.21 or later.',
      advisoryUrl: 'https://github.com/advisories/GHSA-35jh-r3h4-6jhm',
      tool: 'osv-scanner',
      runId: data.tasks.get('task-4')?.runId ?? null,
    }),
    finding('finding-2', 'repo-1', {
      title: 'jsonwebtoken 8.5.1 accepts unverified algorithms',
      severity: 'critical',
      confidence: 'confirmed',
      category: 'vulnerable_dependency',
      location: { path: 'package.json', line: 22 },
      evidence:
        'GHSA-8cf7-32gw-wr33: jwt.verify() can be made to accept an insecure algorithm.',
      remediation:
        'Upgrade jsonwebtoken to 9.0.0 or later and pin the allowed algorithms.',
      advisoryUrl: 'https://github.com/advisories/GHSA-8cf7-32gw-wr33',
      tool: 'osv-scanner',
      runId: data.tasks.get('task-4')?.runId ?? null,
    }),
    finding('finding-3', 'repo-1', {
      title: 'SQL built with string concatenation',
      severity: 'high',
      confidence: 'likely',
      category: 'injection',
      location: { path: 'src/http/search.ts', line: 57 },
      evidence:
        "`db.raw(\\`... WHERE name LIKE '%${query}%'\\`)` interpolates the request parameter.",
      remediation: 'Use a parameterised query or the query builder.',
      advisoryUrl: null,
      tool: 'semgrep',
    }),
    finding('finding-4', 'repo-2', {
      title: 'Markdown rendered without sanitisation',
      severity: 'medium',
      confidence: 'suspected',
      category: 'xss',
      location: { path: 'src/components/report.tsx', line: 112 },
      evidence:
        'dangerouslySetInnerHTML receives the rendered task description. Whether the input is sanitised upstream could not be confirmed.',
      remediation:
        'Sanitise the HTML, or render the markdown through a component tree.',
      advisoryUrl: null,
      tool: 'agent:security',
    }),
    finding('finding-5', 'repo-3', {
      title: 'Database URL written to logs at startup',
      severity: 'critical',
      confidence: 'confirmed',
      category: 'exposed_credential',
      location: { path: 'config/loader.py', line: 33 },
      evidence:
        'logger.info("connecting to %s", settings.database_url) prints the password.',
      remediation: 'Log the host only and rotate the credential.',
      advisoryUrl: null,
      tool: 'gitleaks',
    }),
    finding('finding-6', 'repo-3', {
      title: 'subprocess called with shell=True on user input',
      severity: 'high',
      confidence: 'likely',
      category: 'subprocess',
      location: { path: 'runner/exec.py', line: 81 },
      evidence:
        'subprocess.run(f"git clone {url}", shell=True) with url from the task payload.',
      remediation: 'Pass an argument list and drop shell=True.',
      advisoryUrl: null,
      tool: 'bandit',
    }),
    finding('finding-7', 'repo-4', {
      title: 'Admin routes skip the authorization middleware',
      severity: 'critical',
      confidence: 'likely',
      category: 'access_control',
      location: { path: 'internal/http/admin.go', line: 19 },
      evidence:
        'The admin group is registered before the auth middleware is attached.',
      remediation:
        'Attach the middleware to the admin group, and add a test that an unauthenticated request is rejected.',
      advisoryUrl: null,
      tool: 'agent:security',
    }),
    finding('finding-8', 'repo-4', {
      title: 'Debug endpoints enabled in production config',
      severity: 'medium',
      confidence: 'confirmed',
      category: 'configuration',
      location: { path: 'deploy/prod.hcl', line: 44 },
      evidence: 'enable_pprof = true',
      remediation:
        'Disable pprof in production or guard it behind the admin network.',
      advisoryUrl: null,
      tool: 'semgrep',
    }),
    finding('finding-9', 'repo-4', {
      title: 'No tests around refund authorization',
      severity: 'low',
      confidence: 'confirmed',
      category: 'missing_tests',
      location: { path: 'internal/refunds/authorize.go', line: 1 },
      evidence: 'The package has no _test.go files.',
      remediation: 'Add tests for the authorization decision table.',
      advisoryUrl: null,
      tool: 'agent:security',
    }),
    finding('finding-10', 'repo-4', {
      title: 'Deserialising untrusted YAML with the full loader',
      severity: 'high',
      confidence: 'likely',
      category: 'deserialization',
      location: { path: 'internal/config/load.go', line: 27 },
      evidence: 'yaml.Unmarshal into interface{} on webhook payloads.',
      remediation: 'Decode into a typed struct with KnownFields(true).',
      advisoryUrl: null,
      tool: 'semgrep',
    }),
    finding('finding-11', 'repo-1', {
      title: 'Webhook signature compared with ==',
      severity: 'medium',
      confidence: 'confirmed',
      category: 'other',
      location: { path: 'src/http/webhooks.ts', line: 18 },
      evidence:
        'The HMAC is compared with a plain equality check, which leaks timing.',
      remediation: 'Use crypto.timingSafeEqual.',
      advisoryUrl: null,
      tool: 'semgrep',
      status: 'fixed',
    }),
    // A finding the scanner raised without capturing evidence, on a line the
    // patch does not touch. The review workspace has to say both things.
    finding('finding-12', 'repo-1', {
      title: 'Retry loop may spin when the budget is zero',
      severity: 'low',
      confidence: 'suspected',
      category: 'other',
      location: { path: 'src/retry.ts', line: 120 },
      evidence: '',
      remediation:
        'Add a guard before the loop, or a test that proves it exits.',
      advisoryUrl: null,
      tool: 'review-agent',
      runId: data.tasks.get('task-2')?.runId ?? null,
    }),
  ];
  for (const item of findings) data.findings.set(item.id, item);

  store.notify('org-1', {
    kind: 'finding_detected',
    title: 'Critical finding in forgemind/workers',
    body: 'Database URL written to logs at startup.',
    href: '/security',
  });
  store.notify('org-1', {
    kind: 'task_failed',
    title: 'Trace the timeout in the sandbox runner failed',
    body: 'The developer agent could not reproduce the failure.',
    href: '/tasks/task-5',
  });
  store.notify('org-1', {
    kind: 'member_joined',
    title: 'Lena Fischer joined as a reviewer',
    body: '',
    href: '/settings',
  });
  store.markNotificationsRead('org-1', ['note-1', 'note-2']);

  store.recordAudit('org-1', mariette, 'repository.connected', {
    type: 'repository',
    id: 'repo-3',
    label: 'forgemind/workers',
  });
  store.recordAudit('org-1', ayinde, 'member.invited', {
    type: 'user',
    id: 'user-4',
    label: 'Lena Fischer',
  });
  store.recordAudit('org-1', ayinde, 'repository.revoked', {
    type: 'repository',
    id: 'repo-5',
    label: 'acme/legacy-portal',
  });
}

seedStore.analysisFor = analysisFor;
