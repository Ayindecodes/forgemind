'use client';

import type { ReactNode } from 'react';

import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Metric, MetricGroup } from '@/components/ui/metric';
import { SkeletonText } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import {
  formatBytes,
  formatCompact,
  formatCurrency,
  formatDuration,
  formatNumber,
  formatPercent,
} from '@/lib/format';
import { useUsage } from '@/lib/queries';
import { costView, quotaRatio, runShare, totalTokens } from '@/lib/usage';

/*
 * What the organisation has used this period, straight from the contract.
 * Every figure is a field; nothing is projected. The cost says whether it
 * is an estimate or what was actually billed.
 */

export function UsagePage() {
  const usage = useUsage();

  if (usage.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Usage"
          description="Tokens, sandbox time, resources, quotas and costs."
        />
        <div className="material-solid p-4" aria-busy="true">
          <SkeletonText lines={6} />
        </div>
      </div>
    );
  }
  if (usage.error || !usage.data) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Usage"
          description="Tokens, sandbox time, resources, quotas and costs."
        />
        <div className="material-solid">
          <ErrorState
            title="Could not load usage"
            onRetry={async () => {
              await usage.refetch();
            }}
          />
        </div>
      </div>
    );
  }

  const data = usage.data;
  const cost = costView(data.cost);
  const share = runShare(data);
  const period = `${new Date(data.period.from).toLocaleDateString()} to ${new Date(data.period.to).toLocaleDateString()}`;

  return (
    <div className="flex flex-col gap-6" data-testid="usage-page">
      <PageHeader
        title="Usage"
        description={`Tokens, sandbox time, resources, quotas and costs for ${period}.`}
      />

      <Panel id="cost" title="Cost" testId="cost">
        <div className="p-4">
          <MetricGroup>
            {cost.kind === 'unavailable' ? (
              <Metric
                label={cost.label}
                unavailable={cost.reason}
                data-testid="cost-metric"
                data-kind={cost.kind}
              />
            ) : (
              <Metric
                label={cost.label}
                value={formatCurrency(cost.amountUsd)}
                estimate={cost.kind === 'estimate'}
                data-testid="cost-metric"
                data-kind={cost.kind}
              />
            )}
            <Metric
              label="Tokens"
              value={formatCompact(totalTokens(data))}
              unit="input and output"
              data-testid="tokens-metric"
            />
            <Metric
              label="Sandbox time"
              value={formatDuration(data.sandboxSeconds * 1000)}
              data-testid="sandbox-metric"
            />
            <Metric
              label="Retry overhead"
              value={formatDuration(data.retryOverheadSeconds * 1000)}
              unit="spent on retries"
            />
          </MetricGroup>
          <p className="mt-3 text-xs text-fg-secondary" data-testid="cost-note">
            {cost.kind === 'estimate'
              ? 'Estimated from token and sandbox usage at list prices. The billed amount may differ.'
              : cost.kind === 'actual'
                ? 'The amount billed for this period.'
                : `No cost figure: ${cost.reason}`}
          </p>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel id="tokens" title="Tokens by model" testId="tokens">
          <table
            className="w-full text-left text-sm"
            aria-label="Tokens by model"
          >
            <thead className="text-xs text-fg-secondary">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">Model</th>
                <th className="px-2 py-2 text-right font-medium">Input</th>
                <th className="px-2 py-2 text-right font-medium">Output</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular-nums">
              {data.tokens.map((row) => (
                <tr
                  key={`${row.provider}/${row.model}`}
                  data-testid="token-row"
                >
                  <td className="px-4 py-2">
                    <span className="font-mono text-xs">{row.model}</span>
                    <span className="ml-2 text-xs text-fg-muted">
                      {row.provider}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right">
                    {formatNumber(row.input)}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {formatNumber(row.output)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {formatNumber(row.input + row.output)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel id="runs" title={`Runs (${data.runs.total})`} testId="runs">
          <dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-2 px-4 py-4 text-sm">
            {(
              [
                ['succeeded', 'Succeeded', 'bg-success-fg'],
                ['partial', 'Partial', 'bg-warning-fg'],
                ['unverified', 'Unverified', 'bg-warning-fg'],
                ['failed', 'Failed', 'bg-error-fg'],
              ] as const
            ).map(([key, label, color]) => (
              <Row
                key={key}
                label={label}
                testId={`runs-${key}`}
                count={data.runs[key]}
                ratio={share[key]}
                color={color}
              />
            ))}
          </dl>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel id="resources" title="Resources" testId="resources">
          <div className="p-4">
            <MetricGroup>
              <Metric
                label="CPU"
                value={formatDuration(data.cpuSeconds * 1000)}
              />
              <Metric
                label="Memory"
                value={formatNumber(Math.round(data.memoryMbHours))}
                unit="MB-hours"
              />
              <Metric label="Storage" value={formatBytes(data.storageBytes)} />
            </MetricGroup>
          </div>
        </Panel>

        <Panel id="quotas" title="Quotas" testId="quotas">
          <ul className="flex flex-col gap-3 px-4 py-4 text-sm">
            {(
              [
                ['concurrentRuns', 'Concurrent runs'],
                ['monthlyRuns', 'Runs this month'],
                ['monthlyTokens', 'Tokens this month'],
              ] as const
            ).map(([key, label]) => {
              const quota = data.quotas[key];
              const ratio = quotaRatio(quota);
              return (
                <li
                  key={key}
                  className="flex flex-col gap-1"
                  data-testid={`quota-${key}`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span>{label}</span>
                    <span className="tabular-nums">
                      {formatCompact(quota.used)}
                      <span className="text-fg-secondary">
                        {quota.max === null
                          ? ', no limit'
                          : ` of ${formatCompact(quota.max)}`}
                      </span>
                      {ratio !== null && ratio >= 0.9 && (
                        <Badge className="ml-2" tone="warning">
                          near the limit
                        </Badge>
                      )}
                    </span>
                  </div>
                  {ratio !== null && (
                    <div
                      role="progressbar"
                      aria-label={label}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(ratio * 100)}
                      className="h-1.5 overflow-hidden rounded-full bg-hover"
                    >
                      <div
                        className={
                          ratio >= 0.9
                            ? 'h-full bg-warning-fg'
                            : 'h-full bg-accent'
                        }
                        style={{ width: `${Math.round(ratio * 100)}%` }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function Row({
  label,
  testId,
  count,
  ratio,
  color,
}: {
  label: string;
  testId: string;
  count: number;
  ratio: number;
  color: string;
}) {
  return (
    <>
      <dt data-testid={testId} className="text-fg-secondary">
        {label}
      </dt>
      <dd>
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(ratio * 100)}
          className="h-1.5 overflow-hidden rounded-full bg-hover"
        >
          <div
            className={`h-full ${color}`}
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
      </dd>
      <dd className="text-right tabular-nums">
        {count} <span className="text-fg-muted">{formatPercent(ratio)}</span>
      </dd>
    </>
  );
}

function Panel({
  id,
  title,
  testId,
  children,
}: {
  id: string;
  title: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-testid={testId}
      className="material-solid"
    >
      <h2
        id={`${id}-title`}
        className="border-b border-line px-4 py-3 text-sm font-semibold"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}
