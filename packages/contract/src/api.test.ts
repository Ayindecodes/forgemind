import { describe, expect, it } from 'vitest';

import { buildPath, endpoints } from './api';
import { EventType } from './events';

describe('endpoints', () => {
  it('declare params for every path parameter', () => {
    for (const [key, endpoint] of Object.entries(endpoints)) {
      const names = [...endpoint.path.matchAll(/:([a-zA-Z]+)/g)].map(
        ([, name]) => name,
      );
      const params = 'params' in endpoint ? endpoint.params : undefined;
      const declared = Object.keys(params?.shape ?? {});

      expect(declared, key).toEqual(names);
    }
  });

  it('have unique method and path pairs', () => {
    const pairs = Object.values(endpoints).map(
      ({ method, path }) => `${method} ${path}`,
    );

    expect(new Set(pairs).size).toBe(pairs.length);
  });
});

describe('buildPath', () => {
  it('fills and encodes parameters', () => {
    expect(buildPath('/runs/:id/events', { id: 'run/1' })).toBe(
      '/runs/run%2F1/events',
    );
  });

  it('refuses a missing parameter', () => {
    expect(() => buildPath('/runs/:id')).toThrow('Missing path parameter id');
  });
});

describe('EventType', () => {
  it('lists every event kind', () => {
    expect(EventType.options).toContain('run.started');
    expect(EventType.options).toContain('agent.note');
    expect(EventType.options.length).toBeGreaterThanOrEqual(18);
  });
});
