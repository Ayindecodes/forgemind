import {
  inPeriod,
  meterRun,
  totalUsage,
  UsageSummary,
} from '@forgemind/contract';
import { describe, expect, it } from 'vitest';

import { createStore, type Store } from './store';

const NOON = Date.parse('2026-11-06T12:00:00Z');
const DAY = 86_400_000;

/** A store whose clock the test moves. */
function storeAt(start: number) {
  const clock = { now: start };
  const store = createStore({
    speed: Infinity,
    now: () => new Date(clock.now),
  });
  return { store, clock };
}

/** What the organisation's own events measure, worked out from outside. */
function measured(store: Store, orgId: string) {
  const usage = store.usage(orgId);
  return totalUsage(
    store
      .runs(orgId)
      .flatMap((run) => meterRun(store.eventsAfter(orgId, run.id, 0)))
      .filter(({ at }) => inPeriod(at, usage.period)),
  );
}

describe('the usage summary', () => {
  it('is what the contract says a summary is', () => {
    const { store } = storeAt(NOON);
    expect(UsageSummary.safeParse(store.usage('org-1')).error).toBeUndefined();
  });

  it('adds up to what the events of the period measure', () => {
    const { store } = storeAt(NOON);
    const usage = store.usage('org-1');
    const expected = measured(store, 'org-1');

    expect(expected.tokens.length).toBeGreaterThan(0);
    expect(expected.sandboxSeconds).toBeGreaterThan(0);
    expect(expected.retryOverheadSeconds).toBeGreaterThan(0);
    expect({
      tokens: usage.tokens,
      sandboxSeconds: usage.sandboxSeconds,
      cpuSeconds: usage.cpuSeconds,
      memoryMbHours: usage.memoryMbHours,
      retryOverheadSeconds: usage.retryOverheadSeconds,
    }).toEqual(expected);
    expect(usage.quotas.monthlyTokens.used).toBe(
      expected.tokens.reduce((sum, row) => sum + row.input + row.output, 0),
    );
  });

  it('counts the runs that started in the period, by how they ended', () => {
    const { store } = storeAt(NOON);
    const usage = store.usage('org-1');
    const started = store
      .runs('org-1')
      .filter(({ startedAt }) => startedAt !== null);
    const ended = (outcome: string) =>
      started.filter((run) => run.outcome === outcome).length;

    expect(usage.runs).toEqual({
      total: started.length,
      succeeded: ended('succeeded'),
      partial: ended('partial'),
      failed: ended('failed'),
      unverified: ended('unverified'),
    });
    expect(usage.quotas.monthlyRuns.used).toBe(started.length);
  });

  it('follows the events: a new run adds exactly what it used', () => {
    const { store } = storeAt(NOON);
    const before = store.usage('org-1');
    const session = store.sessionFor('dev-owner');
    const task = store.createTask(session, {
      repositoryId: 'repo-1',
      title: 'Carry the budget over',
      request: 'Keep the remaining retry budget when a plan is revised.',
      category: 'fix_bug',
      budget: { maxMinutes: 30, maxRetries: 1, maxTokens: 200_000 },
    });
    const run = totalUsage(meterRun(store.eventsAfter('org-1', task.runId, 0)));
    const after = store.usage('org-1');

    expect(run.tokens.length).toBeGreaterThan(0);
    expect(after.runs.total).toBe(before.runs.total + 1);
    expect(after.quotas.monthlyTokens.used).toBe(
      before.quotas.monthlyTokens.used +
        run.tokens.reduce((sum, row) => sum + row.input + row.output, 0),
    );
    expect(after.sandboxSeconds).toBeCloseTo(
      before.sandboxSeconds + run.sandboxSeconds,
      4,
    );
  });

  it('leaves out what happened before the period began', () => {
    const { store, clock } = storeAt(NOON);
    const all = store.usage('org-1');
    expect(all.runs.total).toBeGreaterThan(0);

    // The newest seeded history is now more than thirty days old.
    clock.now = NOON + 31 * DAY;
    const later = store.usage('org-1');
    expect(later.runs.total).toBe(0);
    expect(later.tokens).toEqual([]);
    expect(later.sandboxSeconds).toBe(0);
    expect(later.cost).toEqual({ kind: 'estimate', amountUsd: 0 });
    expect(later.quotas.monthlyTokens.used).toBe(0);

    // Part of the history is inside the period, part of it is not.
    const newest = Math.max(
      ...store
        .runs('org-1')
        .flatMap((run) => store.eventsAfter('org-1', run.id, 0))
        .map(({ at }) => Date.parse(at)),
    );
    clock.now = newest + 30 * DAY - 60_000;
    const edge = store.usage('org-1');
    expect(edge.quotas.monthlyTokens.used).toBeLessThan(
      all.quotas.monthlyTokens.used,
    );
    expect({
      tokens: edge.tokens,
      sandboxSeconds: edge.sandboxSeconds,
      cpuSeconds: edge.cpuSeconds,
      memoryMbHours: edge.memoryMbHours,
      retryOverheadSeconds: edge.retryOverheadSeconds,
    }).toEqual(measured(store, 'org-1'));
  });

  it('never calls its cost anything but an estimate', () => {
    const { store } = storeAt(NOON);
    const { cost } = store.usage('org-1');
    expect(cost.kind).toBe('estimate');
    expect(cost.kind === 'estimate' && cost.amountUsd).toBeGreaterThan(0);
  });

  it("shows another organisation none of this one's usage", () => {
    const { store } = storeAt(NOON);
    const other = store.usage('org-2');
    expect(other.runs.total).toBe(0);
    expect(other.tokens).toEqual([]);
    expect(other.cpuSeconds).toBe(0);
    expect(other.quotas.monthlyTokens.used).toBe(0);
  });
});
