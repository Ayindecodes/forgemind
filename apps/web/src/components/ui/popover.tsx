'use client';

import { Popover as RadixPopover } from 'radix-ui';
import type { ComponentProps } from 'react';

import { floating, riseFromSide } from '@/components/ui/floating';
import { cx } from '@/lib/cx';

export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverClose = RadixPopover.Close;

export function PopoverContent({
  className,
  side = 'bottom',
  align = 'start',
  ...props
}: ComponentProps<typeof RadixPopover.Content>) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        side={side}
        align={align}
        sideOffset={6}
        collisionPadding={8}
        className={cx(floating, riseFromSide, 'w-64 p-3', className)}
        {...props}
      />
    </RadixPopover.Portal>
  );
}
