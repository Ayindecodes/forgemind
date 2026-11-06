import type { ReactNode } from 'react';

import { CodeBlock } from '@/components/ui/code-block';
import { Metric, MetricGroup } from '@/components/ui/metric';
import { Status, StatusBadge, statusValues } from '@/components/ui/status';
import { formatCompact, formatCurrency, formatDuration } from '@/lib/format';

import { demoCode } from './demo-data';
import { StatesDemo } from './states-demo';
import { TableDemo } from './table-demo';

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-md font-semibold">{title}</h2>
        {description && <p className="text-fg-secondary">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function ProductShowcase() {
  return (
    <div className="flex flex-col gap-10">
      <Section
        title="Status"
        description="Every status has its own icon and label, so it never depends on color."
      >
        <div
          className="flex flex-wrap gap-x-6 gap-y-3"
          data-testid="status-list"
        >
          {statusValues.map((status) => (
            <Status key={status} status={status} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2" data-testid="status-badges">
          {statusValues.map((status) => (
            <StatusBadge key={status} status={status} />
          ))}
        </div>
        <div className="flex flex-wrap gap-3" data-testid="status-icons">
          {statusValues.map((status) => (
            <Status key={status} status={status} iconOnly size="sm" />
          ))}
          <Status status="passed" label="Passed in 42s" size="sm" />
        </div>
      </Section>

      <Section title="Metrics">
        <div className="material-solid p-4">
          <MetricGroup>
            <Metric
              label="Tokens this week"
              value={formatCompact(1_284_300)}
              delta={{
                value: 0.125,
                percent: true,
                goodWhen: 'down',
                against: 'last week',
              }}
              data-testid="metric-tokens"
            />
            <Metric
              label="Sandbox time"
              value={formatDuration(4_320_000)}
              delta={{
                value: -0.08,
                percent: true,
                goodWhen: 'down',
                against: 'last week',
              }}
            />
            <Metric
              label="Verified runs"
              value="48"
              unit="of 52"
              delta={{ value: 3, goodWhen: 'up' }}
            />
            <Metric label="Cost" value={formatCurrency(38.2)} estimate />
            <Metric
              label="Provider cost"
              unavailable="The provider does not report cost."
            />
            <Metric label="Open findings" loading />
          </MetricGroup>
        </div>
      </Section>

      <Section
        title="Data table"
        description="Rows are rendered only while visible, so ten thousand of them scroll like ten."
      >
        <TableDemo />
      </Section>

      <Section title="Code block">
        <CodeBlock
          code={demoCode}
          lang="typescript"
          title="packages/engine/src/verify.ts"
          highlightLines={[10, 11, 12]}
          maxHeight={360}
        />
      </Section>

      <Section title="Empty, error and no-access states">
        <StatesDemo />
      </Section>
    </div>
  );
}
