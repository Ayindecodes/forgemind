import { describe, expect, it } from 'vitest';

import { HealthResponse } from './health';

describe('HealthResponse', () => {
  it('accepts a healthy response', () => {
    expect(HealthResponse.parse({ status: 'ok' })).toEqual({ status: 'ok' });
  });

  it('rejects any other status', () => {
    expect(HealthResponse.safeParse({ status: 'degraded' }).success).toBe(
      false,
    );
  });
});
