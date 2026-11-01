import { afterEach, describe, expect, it, vi } from 'vitest';

import { isApiHealthy } from './api';

describe('isApiHealthy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is true when the response matches the contract', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ status: 'ok' }));

    await expect(isApiHealthy()).resolves.toBe(true);
  });

  it('is false when the response does not match the contract', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ status: 'degraded' }));

    await expect(isApiHealthy()).resolves.toBe(false);
  });

  it('is false when the request fails', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });

    await expect(isApiHealthy()).resolves.toBe(false);
  });
});
