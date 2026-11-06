import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cx } from '@/lib/cx';
import { formatDelta } from '@/lib/format';

type Delta = {
  /** The change, as a ratio when percent is true. */
  value: number;
  percent?: boolean;
  /** Which direction counts as good. Cost goes down, coverage goes up. */
  goodWhen?: 'up' | 'down';
  /** What the change is measured against, such as "last week". */
  against?: string;
};

type MetricProps = HTMLAttributes<HTMLDivElement> & {
  label: string;
  value?: ReactNode;
  unit?: string;
  delta?: Delta;
  /** Marks a figure the provider did not report exactly. */
  estimate?: boolean;
  /** Why there is no value, shown in place of one. */
  unavailable?: string;
  loading?: boolean;
  className?: string;
};

function DeltaLine({ value, percent, goodWhen, against }: Delta) {
  const direction = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  const Icon =
    direction === 'up'
      ? ArrowUpRight
      : direction === 'down'
        ? ArrowDownRight
        : Minus;
  const good =
    goodWhen && direction !== 'flat' ? direction === goodWhen : undefined;
  const tone =
    good === undefined
      ? 'text-fg-secondary'
      : good
        ? 'text-success-fg'
        : 'text-error-fg';

  return (
    <span className={cx('inline-flex items-center gap-1 text-xs', tone)}>
      <Icon aria-hidden="true" className="size-3.5" />
      <span className="sr-only">{direction} </span>
      <span className="tabular-nums">{formatDelta(value, percent)}</span>
      {against && <span className="text-fg-muted">vs {against}</span>}
    </span>
  );
}

export function Metric({
  label,
  value,
  unit,
  delta,
  estimate = false,
  unavailable,
  loading = false,
  className,
  ...props
}: MetricProps) {
  return (
    <div className={cx('flex min-w-28 flex-col gap-1', className)} {...props}>
      <span className="flex items-center gap-1.5 text-xs text-fg-secondary">
        {label}
        {estimate && <Badge tone="neutral">Estimate</Badge>}
      </span>
      {loading ? (
        <Skeleton className="h-7 w-20" />
      ) : unavailable ? (
        <span className="text-xl leading-7 font-semibold text-fg-muted">
          <span aria-hidden="true">—</span>
          <span className="sr-only">Not available</span>
        </span>
      ) : (
        <span className="text-xl leading-7 font-semibold tabular-nums">
          {value}
          {unit && (
            <span className="ml-1 text-sm font-normal text-fg-secondary">
              {unit}
            </span>
          )}
        </span>
      )}
      {unavailable && !loading && (
        <span className="text-xs text-fg-muted">{unavailable}</span>
      )}
      {delta && !loading && !unavailable && <DeltaLine {...delta} />}
    </div>
  );
}

/** A row of metrics separated by hairlines. */
export function MetricGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'flex flex-wrap gap-y-4 [&>*]:pr-6 [&>*+*]:border-l [&>*+*]:border-line [&>*+*]:pl-6',
        className,
      )}
    >
      {children}
    </div>
  );
}
