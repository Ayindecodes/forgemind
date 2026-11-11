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

  it('reads the seeded data before it changes anything', () => {
    const index = (key: string) => plan.findIndex((probe) => probe.key === key);
    for (const read of ['tasks', 'runs', 'repositories', 'members', 'audit']) {
      expect(index(read)).toBeLessThan(index('createTask'));
    }
    // What the created task yields is read after it exists.
    for (const read of [
      'task',
      'taskRuns',
      'run',
      'runEvents',
      'runEventStream',
    ]) {
      expect(index(read)).toBeGreaterThan(index('cancelTask'));
    }
  });
});
