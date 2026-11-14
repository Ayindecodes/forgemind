import {
  DATA_SOURCE_HEADER,
  initialRun,
  reduceRun,
  type Event,
  type UsageSummary,
} from '@forgemind/contract';
import { describe, expect, it } from 'vitest';

import { run } from './run';
import type { Fetch } from './client';

/** A service of fixed answers. A `body` that is a function answers anew each time. */
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
    const body: unknown =
      typeof route.body === 'function' ? route.body() : route.body;
    return Response.json(body, {
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

describe('an answer held against the rest of the service', () => {
  // One run, which called a model once. The model is invented.
  const events = [
    {
      type: 'run.started',
      baseCommit: 'abc1234',
      branch: null,
      expectsPatch: true,
      maxRetries: 2,
    },
    {
      type: 'model.called',
      agent: 'developer',
      provider: 'example',
      model: 'model-a',
      inputTokens: 120,
      outputTokens: 30,
    },
    { type: 'run.finished', status: 'completed', error: null },
  ].map(
    (payload, index) =>
      ({
        id: `e${index + 1}`,
        runId: 'run-1',
        seq: index + 1,
        at: `2026-11-03T09:00:0${index}.000Z`,
        ...payload,
      }) as Event,
  );
  const recorded = events.reduce(
    reduceRun,
    initialRun('run-1', 'task-1', 'abc1234'),
  );

  /** The summary of that run, saying this many tokens were read. */
  const usage = (input: number): UsageSummary => ({
    period: {
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-14T12:00:00.000Z',
    },
    tokens: [{ provider: 'example', model: 'model-a', input, output: 30 }],
    sandboxSeconds: 0,
    cpuSeconds: 0,
    memoryMbHours: 0,
    runs: { total: 1, succeeded: 0, partial: 0, failed: 1, unverified: 0 },
    retryOverheadSeconds: 0,
    storageBytes: 0,
    cost: { kind: 'unavailable', reason: 'No price is set for the model.' },
    quotas: {
      concurrentRuns: { used: 0, max: null },
      monthlyRuns: { used: 1, max: null },
      monthlyTokens: { used: input + 30, max: null },
    },
  });

  const held = async (
    summary: unknown,
    runs: { status?: number; body: unknown } = {
      body: { items: [recorded], nextCursor: null },
    },
  ) => {
    const result = await run({
      baseUrl: 'http://api.test',
      cookie: '',
      dataSource: 'live',
      pauseMs: 0,
      fetchImpl: service(
        {
          '/usage': { body: summary },
          '/runs': runs,
          '/runs/run-1/events': { body: events },
        },
        { paths: { '/usage': { get: {} } } },
      ),
    });
    return result.results.find(({ key }) => key === 'usage');
  };

  it('passes a usage summary its runs and events account for, and says against what', async () => {
    const result = await held(usage(120));
    expect(result?.verdict).toBe('pass');
    expect(result?.note).toBe('200, adds up to the 3 events of 1 run');
  });

  it('fails one they do not account for, once it has outlasted asking again', async () => {
    let asked = 0;
    const result = await held(() => {
      asked += 1;
      return usage(121);
    });
    expect(result?.verdict).toBe('fail');
    expect(result?.note).toBe(
      'does not agree with the rest of the service: by the 3 events of 1 run, quotas.monthlyTokens.used is 150 and not 151; tokens of example/model-a, input is 120 and not 121',
    );
    expect(asked).toBe(41);
  });

  it('passes one that had only not caught up yet', async () => {
    let asked = 0;
    const result = await held(() => {
      asked += 1;
      return usage(asked < 3 ? 0 : 120);
    });
    expect(result?.verdict).toBe('pass');
    expect(asked).toBe(3);
  });

  it('fails when what it is held against cannot be read', async () => {
    const gone = await held(usage(120), { status: 500, body: null });
    expect(gone?.verdict).toBe('fail');
    expect(gone?.note).toBe('GET /runs answered 500');

    const broken = await held(usage(120), {
      body: { items: [{ id: 'run-1' }] },
    });
    expect(broken?.verdict).toBe('fail');
    expect(broken?.note).toContain('GET /runs breaks the contract: ');
  });
});
