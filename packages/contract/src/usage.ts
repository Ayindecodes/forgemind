import { z } from 'zod';

import { Timestamp } from './common';

const Quota = z.object({
  used: z.number().min(0),
  max: z.number().min(0).nullable(),
});

export const UsageSummary = z.object({
  period: z.object({ from: Timestamp, to: Timestamp }),
  tokens: z.array(
    z.object({
      provider: z.string().min(1),
      model: z.string().min(1),
      input: z.int().min(0),
      output: z.int().min(0),
    }),
  ),
  sandboxSeconds: z.number().min(0),
  cpuSeconds: z.number().min(0),
  memoryMbHours: z.number().min(0),
  runs: z.object({
    total: z.int().min(0),
    succeeded: z.int().min(0),
    partial: z.int().min(0),
    failed: z.int().min(0),
    unverified: z.int().min(0),
  }),
  retryOverheadSeconds: z.number().min(0),
  storageBytes: z.int().min(0),
  /** Estimates and actuals are labelled differently. Never mix them. */
  cost: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('actual'), amountUsd: z.number().min(0) }),
    z.object({ kind: z.literal('estimate'), amountUsd: z.number().min(0) }),
    z.object({ kind: z.literal('unavailable'), reason: z.string() }),
  ]),
  quotas: z.object({
    concurrentRuns: Quota,
    monthlyRuns: Quota,
    monthlyTokens: Quota,
  }),
});

export type UsageSummary = z.infer<typeof UsageSummary>;
