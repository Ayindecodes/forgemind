import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ApiContractError,
  ApiRequestError,
  ApiUnreachableError,
  getDataSource,
  getGitHubProvider,
  request,
  subscribeDataSource,
} from './api-client';

const reply = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-forgemind-data': 'demo' },
    ...init,
  });

describe('request', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('builds the path and query, and parses the response', async () => {
    const fetchMock = vi.fn(async () => reply({ items: [], nextCursor: null }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      request('tasks', { query: { limit: 5, status: 'running' } }),
    ).resolves.toEqual({
      items: [],
      nextCursor: null,
    });

    const [target, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const url = new URL(target);
    expect(url.pathname).toBe('/tasks');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.get('status')).toBe('running');
    expect(init.method).toBe('GET');
  });

  it('fills path parameters and sends a JSON body', async () => {
    const fetchMock = vi.fn(async () => reply({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await request('markNotificationsRead', { body: { ids: ['note-1'] } });

    const [target, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const url = new URL(target);
    expect(url.pathname).toBe('/notifications/read');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ ids: ['note-1'] }));
  });

  it('turns a described error into ApiRequestError', async () => {
    vi.stubGlobal('fetch', async () =>
      reply(
        { error: { code: 'not_found', message: 'Task nope not found' } },
        { status: 404 },
      ),
    );

    await expect(
      request('task', { params: { id: 'nope' } }),
    ).rejects.toMatchObject({
      name: 'ApiRequestError',
      code: 'not_found',
      status: 404,
    });
  });

  it('reports an unreachable API', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });

    await expect(request('session', {})).rejects.toBeInstanceOf(
      ApiUnreachableError,
    );
  });

  it('refuses a response that breaks the contract', async () => {
    vi.stubGlobal('fetch', async () => reply({ status: 'degraded' }));

    await expect(request('health', {})).rejects.toBeInstanceOf(
      ApiContractError,
    );
  });

  it('notes the data source from the response header', async () => {
    vi.stubGlobal('fetch', async () =>
      reply({ status: 'ok' }, { headers: { 'x-forgemind-data': 'live' } }),
    );
    await request('health', {});
    expect(getDataSource()).toBe('live');

    const listener = vi.fn();
    subscribeDataSource(listener);
    vi.stubGlobal('fetch', async () => reply({ status: 'ok' }));
    await request('health', {});

    expect(getDataSource()).toBe('demo');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notes which GitHub the API signs in with', async () => {
    vi.stubGlobal('fetch', async () =>
      reply({ status: 'ok' }, { headers: { 'x-forgemind-github': 'github' } }),
    );
    await request('health', {});
    expect(getGitHubProvider()).toBe('github');

    vi.stubGlobal('fetch', async () =>
      reply(
        { status: 'ok' },
        { headers: { 'x-forgemind-github': 'nonsense' } },
      ),
    );
    await request('health', {});
    expect(getGitHubProvider()).toBe('unknown');
  });

  it('is an error, not a crash, when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response('gateway timeout', { status: 504 }),
    );

    await expect(request('health', {})).rejects.toBeInstanceOf(ApiRequestError);
  });
});
