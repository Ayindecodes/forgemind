import {
  endpoints,
  Installation,
  Organization,
  PullRequest,
  Repository,
  Session,
} from '@forgemind/contract';
import { describe, expect, it } from 'vitest';

import { createApp } from './app';
import { createStore } from './store';

const clock = () => new Date('2026-11-02T12:00:00Z');
const as = (token: string) => ({ headers: { cookie: `fm_session=${token}` } });

function harness() {
  const store = createStore({
    speed: Infinity,
    now: clock,
    apiOrigin: 'http://api.test',
    webOrigin: 'http://web.test',
  });
  return { store, app: createApp(store) };
}

const post = (
  app: ReturnType<typeof createApp>,
  path: string,
  body?: unknown,
  init: RequestInit = {},
) =>
  app.request(path, {
    method: 'POST',
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers as Record<string, string>),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** Walks the simulated GitHub sign-in and returns the session cookie. */
async function signIn(
  app: ReturnType<typeof createApp>,
  userId: string,
  next?: string,
) {
  const start = endpoints.githubStart.response.parse(
    await (await post(app, '/auth/github/start', { next })).json(),
  );
  expect(start.url).toMatch(
    /^http:\/\/api\.test\/auth\/github\/authorize\?state=/,
  );

  const page = await app.request(
    new URL(start.url).pathname + new URL(start.url).search,
  );
  expect(page.status).toBe(200);
  expect(await page.text()).toContain('Simulated GitHub');

  const redirect = await app.request(
    `/auth/github/authorize/continue?state=${start.state}&user=${userId}`,
  );
  expect(redirect.status).toBe(302);
  const target = new URL(redirect.headers.get('location') ?? '');
  expect(target.origin).toBe('http://web.test');
  expect(target.pathname).toBe('/auth/github/callback');

  const callback = await post(app, '/auth/github/callback', {
    code: target.searchParams.get('code'),
    state: target.searchParams.get('state'),
  });
  expect(callback.status).toBe(200);
  const cookie = callback.headers.get('set-cookie') ?? '';
  expect(cookie).toMatch(/^fm_session=session-/);
  expect(cookie).toMatch(/HttpOnly/);

  const token = /fm_session=([^;]+)/.exec(cookie)?.[1] ?? '';
  return { token, session: Session.parse(await callback.json()) };
}

describe('sessions', () => {
  it('refuses requests without a session, and says why', async () => {
    const { app } = harness();

    const signedOut = await app.request('/auth/session');
    expect(signedOut.status).toBe(401);
    expect(await signedOut.json()).toMatchObject({
      error: { code: 'unauthorized', details: { reason: 'signed_out' } },
    });

    const expired = await app.request('/auth/session', as('dev-expired'));
    expect(expired.status).toBe(401);
    expect(await expired.json()).toMatchObject({
      error: { details: { reason: 'expired' } },
    });

    expect((await app.request('/tasks')).status).toBe(401);
  });

  it('signs in as an existing member through the simulated GitHub', async () => {
    const { app } = harness();
    const { token, session } = await signIn(app, 'user-1', '/tasks');

    expect(session).toMatchObject({ organizationId: 'org-1', role: 'owner' });
    expect(session.user.name).toBe('Ayinde');
    expect((await app.request('/auth/session', as(token))).status).toBe(200);

    const out = await post(app, '/auth/sign-out', undefined, as(token));
    expect(out.headers.get('set-cookie')).toMatch(/fm_session=;|Max-Age=0/);
    expect((await app.request('/auth/session', as(token))).status).toBe(401);
  });

  it('rejects a reused or mismatched code', async () => {
    const { app } = harness();
    const start = endpoints.githubStart.response.parse(
      await (await post(app, '/auth/github/start', {})).json(),
    );
    const redirect = await app.request(
      `/auth/github/authorize/continue?state=${start.state}&user=user-1`,
    );
    const target = new URL(redirect.headers.get('location') ?? '');
    const code = target.searchParams.get('code');

    expect(
      (await post(app, '/auth/github/callback', { code, state: 'other' }))
        .status,
    ).toBe(400);
    expect(
      (await post(app, '/auth/github/callback', { code, state: start.state }))
        .status,
    ).toBe(200);
    expect(
      (await post(app, '/auth/github/callback', { code, state: start.state }))
        .status,
    ).toBe(400);
  });
});

describe('a new user', () => {
  it('creates an organization, installs the app, and connects a repository', async () => {
    const { app } = harness();
    const { token, session } = await signIn(app, 'user-5');
    const me = as(token);

    expect(session).toMatchObject({ organizationId: null, role: null });
    expect((await app.request('/repositories', me)).status).toBe(403);
    expect((await app.request('/github/installation', me)).status).toBe(403);

    const created = await post(
      app,
      '/organization',
      { name: 'Rivera Labs' },
      me,
    );
    expect(created.status).toBe(201);
    expect(Organization.parse(await created.json())).toMatchObject({
      slug: 'rivera-labs',
      plan: 'free',
    });
    expect(
      Session.parse(await (await app.request('/auth/session', me)).json()),
    ).toMatchObject({ role: 'owner' });
    expect(
      (await post(app, '/organization', { name: 'Again' }, me)).status,
    ).toBe(409);

    expect(
      await (await app.request('/github/installation', me)).json(),
    ).toEqual({ installation: null });
    expect((await app.request('/github/repositories', me)).status).toBe(409);

    const install = endpoints.installStart.response.parse(
      await (await post(app, '/github/install/start', undefined, me)).json(),
    );
    const page = await app.request(
      new URL(install.url).pathname + new URL(install.url).search,
    );
    const html = await page.text();
    expect(html).toContain('Install ForgeMind on samrivera');
    expect(html).toContain('Pull requests');
    expect(html).not.toMatch(/Administration|Secrets/);

    const redirect = await app.request(
      `/auth/github/install/continue?state=${install.state}`,
    );
    const target = new URL(redirect.headers.get('location') ?? '');
    expect(target.pathname).toBe('/auth/github/installed');
    const done = await post(
      app,
      '/github/install/callback',
      {
        installationId: target.searchParams.get('installation_id'),
        state: target.searchParams.get('state'),
      },
      me,
    );
    expect(done.status).toBe(201);
    expect(Installation.parse(await done.json())).toMatchObject({
      accountLogin: 'samrivera',
      repositorySelection: 'selected',
    });

    const repos = endpoints.githubRepositories.response.parse(
      await (await app.request('/github/repositories', me)).json(),
    );
    expect(repos).toHaveLength(5);
    expect(
      repos.every(
        ({ connectedRepositoryId }) => connectedRepositoryId === null,
      ),
    ).toBe(true);

    const first = repos[0]!;
    const connected = await post(
      app,
      '/repositories',
      { githubId: first.githubId, fullName: first.fullName },
      me,
    );
    expect(connected.status).toBe(201);
    const repo = Repository.parse(await connected.json());
    expect(repo.status).toBe('connected');
    expect(repo.languages.length).toBeGreaterThan(0);

    const again = endpoints.githubRepositories.response.parse(
      await (await app.request('/github/repositories', me)).json(),
    );
    expect(
      again.find(({ githubId }) => githubId === first.githubId)
        ?.connectedRepositoryId,
    ).toBe(repo.id);

    // Nothing from the other organization leaks across.
    const list = endpoints.repositories.response.parse(
      await (await app.request('/repositories', me)).json(),
    );
    expect(list.items.map(({ id }) => id)).toEqual([repo.id]);
    expect((await app.request('/tasks/task-1', me)).status).toBe(404);
    expect((await app.request('/runs/run-1', me)).status).toBe(404);
    expect(
      endpoints.notifications.response.parse(
        await (await app.request('/notifications', me)).json(),
      ),
    ).toEqual([]);
  });
});

describe('roles', () => {
  it('stops a reviewer from connecting repositories or installing the app', async () => {
    const { app, store } = harness();
    store.data.sessions.set('dev-reviewer', {
      userId: 'user-4',
      expiresAt: new Date('2027-01-01T00:00:00Z'),
    });
    const me = as('dev-reviewer');

    expect(
      (
        await post(
          app,
          '/repositories',
          { githubId: 811006, fullName: 'forgemind/docs' },
          me,
        )
      ).status,
    ).toBe(403);
    expect(
      (await post(app, '/github/install/start', undefined, me)).status,
    ).toBe(403);
    expect(
      (await post(app, '/tasks/task-2/approve', undefined, me)).status,
    ).toBe(200);
  });
});

describe('ids', () => {
  it('are never reused, so a new record cannot take over a seeded one', async () => {
    const { app, store } = harness();
    const seeded = {
      orgs: [...store.data.organizations.keys()],
      repos: [...store.data.repositories.keys()],
      prs: [...store.data.pullRequests.keys()],
    };
    const { token } = await signIn(app, 'user-5');
    const me = as(token);

    const org = Organization.parse(
      await (
        await post(app, '/organization', { name: 'Rivera Labs' }, me)
      ).json(),
    );
    expect(seeded.orgs).not.toContain(org.id);
    expect(store.data.organizations.get('org-1')?.name).toBe(
      'Ayinde Creations',
    );

    const owner = as('dev-owner');
    const repo = Repository.parse(
      await (
        await post(
          app,
          '/repositories',
          { githubId: 811006, fullName: 'forgemind/docs' },
          owner,
        )
      ).json(),
    );
    expect(seeded.repos).not.toContain(repo.id);
    expect(store.data.repositories.get('repo-1')?.fullName).toBe(
      'forgemind/api',
    );

    expect(
      (await post(app, '/tasks/task-2/approve', undefined, owner)).status,
    ).toBe(200);
    const pr = PullRequest.parse(
      await (
        await post(app, '/tasks/task-2/pull-request', undefined, owner)
      ).json(),
    );
    expect(seeded.prs).not.toContain(pr.id);
    expect(store.data.pullRequests.get('pr-1')?.number).toBe(118);
  });
});
