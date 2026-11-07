import { DATA_SOURCE_HEADER } from '@forgemind/contract';
import { describe, expect, it } from 'vitest';

import { run } from './run';
import type { Fetch } from './client';

const service = (
  routes: Record<string, { status?: number; body: unknown; source?: string }>,
  openapi: unknown = {
    paths: { '/health': { get: {} }, '/usage': { get: {} } },
  },
): Fetch =>
  (async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === '/openapi.json') return Response.json(openapi);
    const route = routes[url.pathname];
    if (!route) return new Response('not found', { status: 404 });
    return Response.json(route.body, {
      status: route.status ?? 200,
      headers: { [DATA_SOURCE_HEADER]: route.source ?? 'live' },
    });
  }) as Fetch;

describe('running the probes', () => {
  it('passes a response that matches the contract and lists the rest as unimplemented', async () => {
    const summary = await run({
      baseUrl: 'http://api.test',
      cookie: '',
      dataSource: 'live',
      fetchImpl: service(
        { '/health': { body: { status: 'ok', extra: 1 } } },
        { paths: { '/health': { get: {} } } },
      ),
    });
    expect(
      summary.results.find((result) => result.key === 'health')?.verdict,
    ).toBe('pass');
    expect(summary.failed).toBe(0);
    expect(summary.unimplemented).toBe(summary.results.length - 1);
    expect(summary.unprobed).toEqual([]);
  });

  it('fails a response that breaks the contract, names the field, and keeps going', async () => {
    const summary = await run({
      baseUrl: 'http://api.test',
      cookie: '',
      dataSource: 'live',
      fetchImpl: service({
        '/health': { body: { status: 'fine' } },
        '/usage': { body: { period: {} } },
      }),
    });
    const health = summary.results.find((result) => result.key === 'health');
    expect(health?.verdict).toBe('fail');
    expect(health?.note).toContain('status');
    expect(
      summary.results.find((result) => result.key === 'usage')?.verdict,
    ).toBe('fail');
    expect(summary.failed).toBe(2);
  });

  it('fails a wrong status, a wrong data source, and a missing route', async () => {
    const summary = await run({
      baseUrl: 'http://api.test',
      cookie: '',
      dataSource: 'live',
      fetchImpl: service(
        { '/health': { body: { status: 'ok' }, source: 'demo' } },
        { paths: { '/health': { get: {} }, '/usage': { get: {} } } },
      ),
    });
    expect(
      summary.results.find((result) => result.key === 'health')?.note,
    ).toContain('expected live');
    expect(
      summary.results.find((result) => result.key === 'usage')?.note,
    ).toContain('got 404');
  });

  it('marks a probe blocked when an earlier result it needs is missing', async () => {
    const summary = await run({
      baseUrl: 'http://api.test',
      cookie: '',
      dataSource: 'live',
      fetchImpl: service(
        { '/tasks': { body: { items: [], nextCursor: null } } },
        { paths: { '/tasks': { get: {} }, '/tasks/{id}': { get: {} } } },
      ),
    });
    expect(
      summary.results.find((result) => result.key === 'tasks')?.verdict,
    ).toBe('pass');
    expect(
      summary.results.find((result) => result.key === 'task')?.verdict,
    ).toBe('blocked');
    expect(summary.failed).toBe(0);
  });
});
