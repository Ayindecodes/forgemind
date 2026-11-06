import type { UsageSummary } from '@forgemind/contract';

/*
 * Words and arithmetic for the usage page. Estimates and actuals are never
 * shown the same way: the label says which, and an estimate carries its
 * badge wherever it appears.
 */

export type CostView =
  | { kind: 'actual'; label: 'Actual cost'; amountUsd: number }
  | { kind: 'estimate'; label: 'Estimated cost'; amountUsd: number }
  | { kind: 'unavailable'; label: 'Cost'; reason: string };

export function costView(cost: UsageSummary['cost']): CostView {
  switch (cost.kind) {
    case 'actual':
      return {
        kind: 'actual',
        label: 'Actual cost',
        amountUsd: cost.amountUsd,
      };
    case 'estimate':
      return {
        kind: 'estimate',
        label: 'Estimated cost',
        amountUsd: cost.amountUsd,
      };
    case 'unavailable':
      return { kind: 'unavailable', label: 'Cost', reason: cost.reason };
  }
}

export const totalTokens = (usage: UsageSummary) =>
  usage.tokens.reduce((sum, { input, output }) => sum + input + output, 0);

/** How much of a quota is used, as a ratio, or null when there is no limit. */
export const quotaRatio = (quota: { used: number; max: number | null }) =>
  quota.max === null || quota.max === 0
    ? null
    : Math.min(1, quota.used / quota.max);

export const runShare = (usage: UsageSummary) => {
  const { total, succeeded, partial, failed, unverified } = usage.runs;
  const share = (count: number) => (total === 0 ? 0 : count / total);
  return {
    succeeded: share(succeeded),
    partial: share(partial),
    failed: share(failed),
    unverified: share(unverified),
  };
};
