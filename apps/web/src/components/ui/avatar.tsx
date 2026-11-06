import { cx } from '@/lib/cx';

/** Initials on a tile. Images come later, when GitHub profiles are real. */
export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-accent-subtle font-medium text-accent-fg select-none',
        size === 'sm' ? 'size-6 text-xs' : 'size-7 text-sm',
        className,
      )}
    >
      {initials}
    </span>
  );
}
