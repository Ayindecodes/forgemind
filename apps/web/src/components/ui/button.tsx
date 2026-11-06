'use client';

import { LoaderCircle } from 'lucide-react';
import { Slot } from 'radix-ui';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cx } from '@/lib/cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover',
  secondary: 'border border-line-control bg-elevated text-fg hover:bg-hover',
  ghost: 'text-fg-secondary hover:bg-hover hover:text-fg',
  danger:
    'border border-error-fg bg-elevated text-error-fg hover:bg-error-subtle',
};

export const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-sm pointer-coarse:h-9',
  md: 'h-8 px-3 text-base pointer-coarse:h-10',
};

export const buttonBase =
  'press inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-50';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks input until the work finishes. */
  loading?: boolean;
  icon?: ReactNode;
  /** Renders the child element (such as a link) with the button's styling. */
  asChild?: boolean;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  asChild = false,
  className,
  disabled,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot.Root : 'button';
  const leading = loading ? <LoaderCircle className="animate-spin" /> : icon;

  return (
    <Component
      className={cx(
        buttonBase,
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      type={asChild ? undefined : type}
      {...props}
    >
      {leading && (
        <span aria-hidden="true" className="flex shrink-0 *:size-4">
          {leading}
        </span>
      )}
      <Slot.Slottable>{children}</Slot.Slottable>
    </Component>
  );
}
