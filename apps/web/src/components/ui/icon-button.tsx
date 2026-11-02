'use client';

import type { ReactNode } from 'react';

import { Button, type ButtonProps } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { cx } from '@/lib/cx';

type IconButtonProps = Omit<ButtonProps, 'icon' | 'children'> & {
  /** Read by screen readers and shown as the tooltip. */
  label: string;
  icon: ReactNode;
  tooltip?: boolean;
};

export function IconButton({
  label,
  icon,
  size = 'md',
  tooltip = true,
  className,
  ...props
}: IconButtonProps) {
  const button = (
    <Button
      aria-label={label}
      size={size}
      icon={icon}
      className={cx(size === 'sm' ? 'w-7 px-0' : 'w-8 px-0', className)}
      {...props}
    />
  );

  return tooltip ? <Tooltip content={label}>{button}</Tooltip> : button;
}
