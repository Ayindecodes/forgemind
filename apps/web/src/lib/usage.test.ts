import type { UsageSummary } from '@forgemind/contract';
import { describe, expect, it } from 'vitest';

import { costView, quotaRatio, runShare, totalTokens } from './usage';

const usage: UsageSummary = {
  period: { from: '2026-10-07T00:00:00Z', to: '2026-11-06T00:00:00Z' },
  tokens: [
    {
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      input: 1000,
      output: 200,
    },
    {
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      input: 3000,
      output: 400,
    },
  ],
  sandboxSeconds: 276,
  cpuSeconds: 66,
  memoryMbHours: 110,
  runs: { total: 10, succeeded: 6, partial: 1, failed: 1, unverified: 2 },
  retryOverheadSeconds: 40,
  storageBytes: 1024,
  cost: { kind: 'estimate', amountUsd: 41.04 },
  quotas: {
    concurrentRuns: { used: 1, max: 3 },
    monthlyRuns: { used: 12, max: 200 },
    monthlyTokens: { used: 5000, max: null },
  },
};

describe('costView', () => {
  it('labels estimates, actuals and the unavailable case differently', () => {
    expect(costView({ kind: 'estimate', amountUsd: 1 })).toMatchObject({
      label: 'Estimated cost',
    });
    expect(costView({ kind: 'actual', amountUsd: 1 })).toMatchObject({
      label: 'Actual cost',
    });
    expect(
      costView({ kind: 'unavailable', reason: 'No billing yet' }),
    ).toMatchObject({
      label: 'Cost',
      reason: 'No billing yet',
    });
    expect(costView({ kind: 'estimate', amountUsd: 1 }).label).not.toBe(
      costView({ kind: 'actual', amountUsd: 1 }).label,
    );
  });
});

describe('arithmetic', () => {
  it('adds tokens, ratios quotas and shares runs', () => {
    expect(totalTokens(usage)).toBe(4600);
    expect(quotaRatio({ used: 12, max: 200 })).toBeCloseTo(0.06);
    expect(quotaRatio({ used: 5, max: null })).toBeNull();
    expect(quotaRatio({ used: 9, max: 3 })).toBe(1);
    expect(runShare(usage)).toEqual({
      succeeded: 0.6,
      partial: 0.1,
      failed: 0.1,
      unverified: 0.2,
    });
  });
});
