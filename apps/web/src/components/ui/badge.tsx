import type { HTMLAttributes, ReactNode } from 'react';

import { cx } from '@/lib/cx';

export type BadgeTone =
  'neutral' | 'accent' | 'success' | 'warning' | 'error' | 'info';

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-hover text-fg-secondary',
  accent: 'bg-accent-subtle text-accent-fg',
  success: 'bg-success-subtle text-success-fg',
  warning: 'bg-warning-subtle text-warning-fg',
  error: 'bg-error-subtle text-error-fg',
  info: 'bg-info-subtle text-info-fg',
};

/** Meaning comes from the text and the optional icon, never from color alone. */
export function Badge({
  tone = 'neutral',
  icon,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; icon?: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-xs font-medium whitespace-nowrap',
        tones[tone],
        className,
      )}
      {...props}
    >
      {icon && (
        <span aria-hidden="true" className="flex *:size-3">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}
