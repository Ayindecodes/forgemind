import { HealthResponse } from '@forgemind/contract';
import { describe, expect, it } from 'vitest';

import { app } from './app';

describe('GET /health', () => {
  it('returns a response matching the contract', async () => {
    const response = await app.request('/health');

    expect(response.status).toBe(200);
    expect(HealthResponse.parse(await response.json())).toEqual({
      status: 'ok',
    });
  });
});
