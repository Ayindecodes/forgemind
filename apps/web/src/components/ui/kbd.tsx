import type { HTMLAttributes } from 'react';

import { cx } from '@/lib/cx';

export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cx(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line bg-surface px-1 font-mono text-xs text-fg-secondary',
        className,
      )}
      {...props}
    />
  );
}

/** A key combination, such as ["⌘", "K"]. */
export function Shortcut({
  keys,
  className,
}: {
  keys: readonly string[];
  className?: string;
}) {
  return (
    <span className={cx('inline-flex items-center gap-0.5', className)}>
      {keys.map((key, index) => (
        <Kbd key={index}>{key}</Kbd>
      ))}
    </span>
  );
}
