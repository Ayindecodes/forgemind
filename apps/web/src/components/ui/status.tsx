import {
  Ban,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleMinus,
  CircleX,
  Clock,
  LoaderCircle,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

import { Badge, type BadgeTone } from '@/components/ui/badge';
import { cx } from '@/lib/cx';

/*
 * Every status has its own icon and label, so meaning never depends on color.
 * The first six are stage states; the rest are run outcomes.
 */

export type StatusValue =
  | 'pending'
  | 'running'
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'awaiting'
  | 'partial'
  | 'unverified'
  | 'verified';

type StatusMeta = {
  label: string;
  icon: LucideIcon;
  tone: BadgeTone;
  /** Real activity is the one case for continuous motion. */
  spin?: boolean;
};

export const statuses: Record<StatusValue, StatusMeta> = {
  pending: { label: 'Pending', icon: CircleDashed, tone: 'neutral' },
  running: { label: 'Running', icon: LoaderCircle, tone: 'accent', spin: true },
  passed: { label: 'Passed', icon: CircleCheck, tone: 'success' },
  failed: { label: 'Failed', icon: CircleX, tone: 'error' },
  skipped: { label: 'Skipped', icon: CircleMinus, tone: 'neutral' },
  cancelled: { label: 'Cancelled', icon: Ban, tone: 'neutral' },
  awaiting: { label: 'Awaiting approval', icon: Clock, tone: 'info' },
  partial: { label: 'Partial', icon: CircleAlert, tone: 'warning' },
  unverified: { label: 'Unverified', icon: CircleHelp, tone: 'warning' },
  verified: { label: 'Verified', icon: ShieldCheck, tone: 'success' },
};

export const statusValues = Object.keys(statuses) as StatusValue[];

const toneText: Record<BadgeTone, string> = {
  neutral: 'text-fg-secondary',
  accent: 'text-accent-fg',
  success: 'text-success-fg',
  warning: 'text-warning-fg',
  error: 'text-error-fg',
  info: 'text-info-fg',
};

type StatusProps = {
  status: StatusValue;
  /** Replaces the default label, for example "Passed in 42s". */
  label?: string;
  /** Hides the text visually. Screen readers still get it. */
  iconOnly?: boolean;
  size?: 'sm' | 'md';
  className?: string;
};

export function Status({
  status,
  label,
  iconOnly = false,
  size = 'md',
  className,
}: StatusProps) {
  const { icon: Icon, label: defaultLabel, tone, spin } = statuses[status];
  const text = label ?? defaultLabel;

  return (
    <span
      data-status={status}
      className={cx(
        'inline-flex items-center gap-1.5 font-medium',
        size === 'sm' ? 'text-sm' : 'text-base',
        toneText[tone],
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cx(
          'shrink-0',
          size === 'sm' ? 'size-3.5' : 'size-4',
          spin && 'animate-spin',
        )}
      />
      <span className={iconOnly ? 'sr-only' : undefined}>{text}</span>
    </span>
  );
}

export function StatusBadge({
  status,
  label,
  className,
}: Pick<StatusProps, 'status' | 'label' | 'className'>) {
  const { icon: Icon, label: defaultLabel, tone, spin } = statuses[status];

  return (
    <Badge
      tone={tone}
      icon={<Icon className={spin ? 'animate-spin' : undefined} />}
      data-status={status}
      className={className}
    >
      {label ?? defaultLabel}
    </Badge>
  );
}
