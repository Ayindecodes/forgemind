import { endpoints, type EndpointKey } from '@forgemind/contract';
import { describe, expect, it } from 'vitest';

import { plan } from './plan';

describe('the plan', () => {
  it('probes every endpoint in the contract exactly once', () => {
    const keys = plan.map((probe) => probe.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(
      (Object.keys(endpoints) as EndpointKey[]).sort(),
    );
  });

  it('reads before it writes', () => {
    const firstWrite = plan.findIndex(
      (probe) => endpoints[probe.key].method !== 'GET',
    );
    const lastRead = plan
      .map((probe, index) => ({ probe, index }))
      .filter(({ probe }) => endpoints[probe.key].method === 'GET')
      .at(-1)!.index;
    expect(firstWrite).toBeGreaterThan(lastRead);
  });
});
