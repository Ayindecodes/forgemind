import { endpoints, Member } from '@forgemind/contract';
import { describe, expect, it } from 'vitest';

import { createApp } from './app';
import { createStore } from './store';

const clock = () => new Date('2026-11-06T12:00:00Z');
const as = (token: string) => ({ cookie: `fm_session=${token}` });

function harness() {
  const store = createStore({ speed: Infinity, now: clock });
  const app = createApp(store);
  const call = async (
    path: string,
    init: RequestInit & { token?: string } = {},
  ) => {
    const { token = 'dev-owner', ...rest } = init;
    const response = await app.request(path, {
      ...rest,
      headers: {
        'content-type': 'application/json',
        ...as(token),
        ...(rest.headers ?? {}),
      },
    });
    return {
      status: response.status,
      body: await response.json().catch(() => null),
    };
  };
  return { store, call };
}

describe('members', () => {
  it('lets an owner invite, change a role, and remove', async () => {
    const { call } = harness();
    const invited = await call('/organization/members', {
      method: 'POST',
      body: JSON.stringify({
        email: 'new@example.com',
        name: 'New Person',
        role: 'viewer',
      }),
    });
    expect(invited.status).toBe(201);
    const member = Member.parse(invited.body);
    expect(member.role).toBe('viewer');

    const changed = await call(`/organization/members/${member.user.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'developer' }),
    });
    expect(Member.parse(changed.body).role).toBe('developer');

    const removed = await call(`/organization/members/${member.user.id}`, {
      method: 'DELETE',
    });
    expect(removed.status).toBe(200);
    const list = endpoints.members.response.parse(
      (await call('/organization/members')).body,
    );
    expect(list.some((entry) => entry.user.id === member.user.id)).toBe(false);
  });

  it("keeps at least one owner and keeps owners out of admins' reach", async () => {
    const { call, store } = harness();
    const owners = store
      .members('org-1')
      .filter(({ role }) => role === 'owner');
    expect(owners).toHaveLength(1);
    const demote = await call(`/organization/members/${owners[0]!.user.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(demote.status).toBe(409);
    const remove = await call(`/organization/members/${owners[0]!.user.id}`, {
      method: 'DELETE',
    });
    expect(remove.status).toBe(409);
  });

  it('refuses members who cannot manage members', async () => {
    const { call, store } = harness();
    // Sam has no organisation; a reviewer is a member who cannot manage.
    const reviewer = store
      .members('org-1')
      .find(({ role }) => role === 'reviewer');
    expect(reviewer).toBeDefined();
    store.data.sessions.set('dev-reviewer', {
      userId: reviewer!.user.id,
      expiresAt: new Date('2027-01-01'),
    });
    const attempt = await call('/organization/members', {
      method: 'POST',
      token: 'dev-reviewer',
      body: JSON.stringify({
        email: 'x@example.com',
        name: 'X',
        role: 'viewer',
      }),
    });
    expect(attempt.status).toBe(403);
  });

  it('ends the sessions of a removed member', async () => {
    const { call, store } = harness();
    const invited = Member.parse(
      (
        await call('/organization/members', {
          method: 'POST',
          body: JSON.stringify({
            email: 'gone@example.com',
            name: 'Gone Soon',
            role: 'viewer',
          }),
        })
      ).body,
    );
    store.data.sessions.set('dev-gone', {
      userId: invited.user.id,
      expiresAt: new Date('2027-01-01'),
    });
    expect((await call('/auth/session', { token: 'dev-gone' })).status).toBe(
      200,
    );
    await call(`/organization/members/${invited.user.id}`, {
      method: 'DELETE',
    });
    expect((await call('/auth/session', { token: 'dev-gone' })).status).toBe(
      401,
    );
  });
});
