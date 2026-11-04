import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';

/**
 * What a list or page shows before it has anything in it. It says what will
 * appear here and, when there is one, offers the next step.
 */
export function EmptyState({
  icon,
  title,
  description,
  children,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description: ReactNode;
  /** Actions, such as a button that creates the first item. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'flex flex-col items-center gap-4 rounded-xl border border-dashed border-line px-6 py-12 text-center',
        className,
      )}
    >
      {icon && (
        <span
          aria-hidden="true"
          className="flex size-10 items-center justify-center rounded-lg border border-line bg-surface text-fg-secondary *:size-5"
        >
          {icon}
        </span>
      )}
      <div className="flex max-w-md flex-col gap-1">
        <h2 className="text-md font-semibold">{title}</h2>
        <p className="text-fg-secondary">{description}</p>
      </div>
      {children && (
        <div className="flex flex-wrap justify-center gap-2">{children}</div>
      )}
    </div>
  );
}
