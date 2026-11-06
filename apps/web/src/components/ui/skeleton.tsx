import type { HTMLAttributes } from 'react';

import { cx } from '@/lib/cx';

/** A placeholder with the shape of the content that is still loading. */
export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      data-skeleton=""
      className={cx('animate-pulse rounded-md bg-hover', className)}
      {...props}
    />
  );
}

export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div aria-hidden="true" className={cx('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={cx('h-3.5', index === lines - 1 ? 'w-2/3' : 'w-full')}
        />
      ))}
    </div>
  );
}

export function Spinner({
  label = 'Loading',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <svg
      role="status"
      aria-label={label}
      viewBox="0 0 16 16"
      fill="none"
      className={cx('size-4 animate-spin text-fg-secondary', className)}
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2"
      />
      <path
        d="M14 8a6 6 0 0 0-6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
