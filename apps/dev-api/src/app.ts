import {
  ApiError,
  ConnectRepository,
  CreateOrganization,
  CreateTask,
  DATA_SOURCE_HEADER,
  endpoints,
  EventQuery,
  FindingQuery,
  GitHubCallback,
  GitHubStart,
  HealthResponse,
  InstallCallback,
  UpdateMemberRole,
  InviteMember,
  PageQuery,
  RunQuery,
  TaskQuery,
  type ErrorCode,
  type Session,
} from '@forgemind/contract';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';

import { ApiFailure } from './errors';
import { simulatedGitHubPage } from './github-pages';
import { streamRunEvents } from './sse';
import { createStore, SESSION_COOKIE, type Store } from './store';

export { ApiFailure } from './errors';

const statusFor: Record<ErrorCode, ContentfulStatusCode> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
};

const fail = (
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
) => new ApiFailure(code, message, details);

function query<T extends z.ZodObject>(c: Context, schema: T): z.infer<T> {
  const raw = Object.fromEntries(new URL(c.req.url).searchParams);
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw fail('invalid', 'Invalid query', { issues: result.error.issues });
  }
  return result.data;
}

async function body<T extends z.ZodObject>(
  c: Context,
  schema: T,
): Promise<z.infer<T>> {
  const raw = await c.req.json().catch(() => undefined);
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw fail('invalid', 'Invalid request body', {
      issues: result.error.issues,
    });
  }
  return result.data;
}

function paginate<T>(items: T[], { cursor, limit }: z.infer<typeof PageQuery>) {
  const offset = cursor ? Number.parseInt(cursor, 10) : 0;
  if (Number.isNaN(offset) || offset < 0)
    throw fail('invalid', 'Invalid cursor');

  const slice = items.slice(offset, offset + limit);
  const next = offset + limit;

  return {
    items: slice,
    nextCursor: next < items.length ? String(next) : null,
  };
}

const SESSION_MAX_AGE = 7 * 86_400;

export function createApp(store: Store) {
  const app = new Hono();

  app.use(
    cors({
      origin: store.options.webOrigin,
      // The web client sends credentials, as it will with real sessions.
      credentials: true,
      // Browsers hide custom response headers unless they are exposed.
      exposeHeaders: [DATA_SOURCE_HEADER],
    }),
  );

  app.use('*', async (c, next) => {
    c.header(DATA_SOURCE_HEADER, 'demo');
    await next();
  });

  app.onError((error, c) => {
    const failure =
      error instanceof ApiFailure
        ? error
        : fail('internal', 'Something went wrong');
    const payload: ApiError = {
      error: {
        code: failure.code,
        message: failure.message,
        details: failure.details,
      },
    };

    return c.json(payload, statusFor[failure.code]);
  });

  app.notFound((c) => {
    const payload: ApiError = {
      error: { code: 'not_found', message: 'No such route' },
    };
    return c.json(payload, 404);
  });

  const e = endpoints;
  const id = (c: Context) => {
    const value = c.req.param('id');
    if (!value) throw fail('invalid', 'Missing id');
    return value;
  };
  const token = (c: Context) => getCookie(c, SESSION_COOKIE);
  const session = (c: Context): Session => store.sessionFor(token(c));
  /** The signed-in user's organization. Everything below is scoped to it. */
  const org = (c: Context) => {
    const current = session(c);
    if (!current.organizationId)
      throw fail('forbidden', 'Create an organization first');
    return { session: current, orgId: current.organizationId };
  };
  const setSession = (c: Context, value: string) =>
    setCookie(c, SESSION_COOKIE, value, {
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: SESSION_MAX_AGE,
    });

  app.get(e.health.path, (c) => c.json(HealthResponse.parse({ status: 'ok' })));

  /* Sessions and the simulated GitHub */

  app.get(e.session.path, (c) => c.json(session(c)));
  app.post(e.signOut.path, (c) => {
    store.signOut(token(c));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true as const });
  });
  app.post(e.githubStart.path, async (c) => {
    const { next } = await body(c, GitHubStart);
    return c.json(store.startSignIn(next ?? null));
  });
  app.post(e.githubCallback.path, async (c) => {
    const { code, state } = await body(c, GitHubCallback);
    const result = store.completeSignIn(code, state);
    setSession(c, result.token);
    return c.json(result.session);
  });

  app.get('/auth/github/authorize', (c) => {
    const state = c.req.query('state') ?? '';
    const choices = store.signInChoices(state);
    return c.html(
      simulatedGitHubPage({
        title: 'Authorize ForgeMind',
        intro:
          'ForgeMind wants to read your GitHub identity and email address. Nothing else is granted here; repository access is a separate, later step.',
        actions: choices.map(({ user, account, isNew }) => ({
          label: `Authorize as ${user.name} (${account.login}${isNew ? ', new to ForgeMind' : ''})`,
          href: `/auth/github/authorize/continue?state=${encodeURIComponent(state)}&user=${encodeURIComponent(user.id)}`,
        })),
      }),
    );
  });
  app.get('/auth/github/authorize/continue', (c) => {
    const state = c.req.query('state') ?? '';
    const userId = c.req.query('user') ?? '';
    const code = store.issueCode(state, userId);
    const target = new URL('/auth/github/callback', store.options.webOrigin);
    target.searchParams.set('code', code);
    target.searchParams.set('state', state);
    return c.redirect(target.toString());
  });

  /* Organizations and the GitHub App */

  app.get(e.organization.path, (c) => c.json(store.organization(org(c).orgId)));
  app.post(e.createOrganization.path, async (c) => {
    const { name } = await body(c, CreateOrganization);
    return c.json(store.createOrganization(session(c), name), 201);
  });
  app.get(e.members.path, (c) => c.json(store.members(org(c).orgId)));
  app.post(e.inviteMember.path, async (c) =>
    c.json(store.inviteMember(session(c), await body(c, InviteMember)), 201),
  );
  app.patch(e.updateMemberRole.path, async (c) => {
    const { role } = await body(c, UpdateMemberRole);
    return c.json(store.updateMemberRole(session(c), id(c), role));
  });
  app.delete(e.removeMember.path, (c) => {
    store.removeMember(session(c), id(c));
    return c.json({ ok: true as const });
  });
  app.get(e.installation.path, (c) =>
    c.json({ installation: store.installation(org(c).orgId) }),
  );
  app.post(e.installStart.path, (c) => c.json(store.startInstall(session(c))));
  app.post(e.installCallback.path, async (c) => {
    const { installationId, state } = await body(c, InstallCallback);
    return c.json(
      store.completeInstall(session(c), installationId, state),
      201,
    );
  });
  app.get(e.githubRepositories.path, (c) =>
    c.json(store.githubRepositories(session(c))),
  );

  app.get('/auth/github/install', (c) => {
    const state = c.req.query('state') ?? '';
    const { account, organization, permissions } = store.installChoice(state);
    return c.html(
      simulatedGitHubPage({
        title: `Install ForgeMind on ${account.login}`,
        intro: `This installs the ForgeMind GitHub App on the ${account.type} ${account.login}, for the ForgeMind organization "${organization.name}". It asks only for what is listed below.`,
        permissions,
        actions: [
          {
            label: 'Install',
            href: `/auth/github/install/continue?state=${encodeURIComponent(state)}`,
          },
        ],
      }),
    );
  });
  app.get('/auth/github/install/continue', (c) => {
    const state = c.req.query('state') ?? '';
    store.installChoice(state);
    const target = new URL('/auth/github/installed', store.options.webOrigin);
    target.searchParams.set('installation_id', store.nextId('installation'));
    target.searchParams.set('state', state);
    return c.redirect(target.toString());
  });

  /* Repositories */

  app.get(e.repositories.path, (c) =>
    c.json(paginate(store.repositories(org(c).orgId), query(c, PageQuery))),
  );
  app.post(e.connectRepository.path, async (c) =>
    c.json(
      store.connectRepository(session(c), await body(c, ConnectRepository)),
      201,
    ),
  );
  app.get(e.repository.path, (c) =>
    c.json(store.repository(org(c).orgId, id(c))),
  );
  app.delete(e.disconnectRepository.path, (c) => {
    store.disconnectRepository(session(c), id(c));
    return c.json({ ok: true as const });
  });
  app.get(e.repositoryAnalysis.path, (c) =>
    c.json(store.analysis(org(c).orgId, id(c))),
  );

  /* Tasks and runs */

  app.get(e.tasks.path, (c) => {
    const { cursor, limit, ...filter } = query(
      c,
      PageQuery.extend(TaskQuery.shape),
    );
    return c.json(
      paginate(store.tasks(org(c).orgId, filter), { cursor, limit }),
    );
  });
  app.post(e.createTask.path, async (c) =>
    c.json(store.createTask(session(c), await body(c, CreateTask)), 201),
  );
  app.get(e.task.path, (c) => c.json(store.task(org(c).orgId, id(c))));
  app.post(e.cancelTask.path, (c) =>
    c.json(store.cancelTask(session(c), id(c))),
  );
  app.post(e.approveTask.path, (c) =>
    c.json(store.decide(session(c), id(c), 'approved')),
  );
  app.post(e.rejectTask.path, (c) =>
    c.json(store.decide(session(c), id(c), 'rejected')),
  );
  app.post(e.requestRevision.path, async (c) => {
    const { instructions } = await body(c, e.requestRevision.body);
    return c.json(store.requestRevision(session(c), id(c), instructions));
  });
  app.post(e.openPullRequest.path, (c) =>
    c.json(store.openPullRequest(session(c), id(c)), 201),
  );
  app.get(e.taskRuns.path, (c) => c.json(store.taskRuns(org(c).orgId, id(c))));

  app.get(e.runs.path, (c) => {
    const { cursor, limit, ...filter } = query(
      c,
      PageQuery.extend(RunQuery.shape),
    );
    return c.json(
      paginate(store.runs(org(c).orgId, filter), { cursor, limit }),
    );
  });
  app.get(e.run.path, (c) => c.json(store.run(org(c).orgId, id(c))));
  app.get(e.runEvents.path, (c) => {
    const { after } = query(c, EventQuery);
    return c.json(store.eventsAfter(org(c).orgId, id(c), after));
  });
  app.get(e.runEventStream.path, (c) => {
    const { orgId } = org(c);
    const lastEventId = c.req.header('last-event-id');
    const after = lastEventId
      ? Number.parseInt(lastEventId, 10)
      : query(c, EventQuery).after;
    store.run(orgId, id(c));
    return streamRunEvents(
      c,
      store,
      orgId,
      id(c),
      Number.isNaN(after) ? 0 : after,
    );
  });
  app.get(e.runDiff.path, (c) => c.json(store.runDiff(org(c).orgId, id(c))));
  app.get(e.runReport.path, (c) => c.json(store.report(org(c).orgId, id(c))));

  /* The rest */

  app.get(e.findings.path, (c) => {
    const { cursor, limit, ...filter } = query(
      c,
      PageQuery.extend(FindingQuery.shape),
    );
    return c.json(
      paginate(store.findings(org(c).orgId, filter), { cursor, limit }),
    );
  });
  app.get(e.pullRequests.path, (c) =>
    c.json(paginate(store.pullRequests(org(c).orgId), query(c, PageQuery))),
  );
  app.get(e.usage.path, (c) => c.json(store.usage(org(c).orgId)));
  app.get(e.notifications.path, (c) =>
    c.json(store.notifications(org(c).orgId)),
  );
  app.post(e.markNotificationsRead.path, async (c) => {
    const { ids } = await body(c, e.markNotificationsRead.body);
    store.markNotificationsRead(org(c).orgId, ids);
    return c.json({ ok: true as const });
  });
  app.get(e.audit.path, (c) =>
    c.json(paginate(store.audit(org(c).orgId), query(c, PageQuery))),
  );

  return app;
}

const speed =
  process.env.DEV_API_SPEED === 'Infinity'
    ? Infinity
    : Number(process.env.DEV_API_SPEED ?? 1);
const port = process.env.PORT ?? '4000';

export const app = createApp(
  createStore({
    seed: Number(process.env.DEV_API_SEED ?? 1),
    speed:
      speed === Infinity || (Number.isFinite(speed) && speed > 0) ? speed : 1,
    apiOrigin: process.env.DEV_API_ORIGIN ?? `http://localhost:${port}`,
    webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3200',
  }),
);
