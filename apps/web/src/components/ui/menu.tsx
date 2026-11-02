'use client';

import { DropdownMenu } from 'radix-ui';
import type { ComponentProps } from 'react';

import { floating, menuItem, riseFromSide } from '@/components/ui/floating';
import { Shortcut } from '@/components/ui/kbd';
import { cx } from '@/lib/cx';

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

export function MenuContent({
  className,
  align = 'start',
  ...props
}: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={align}
        sideOffset={6}
        collisionPadding={8}
        className={cx(floating, riseFromSide, 'min-w-44 p-1', className)}
        {...props}
      />
    </DropdownMenu.Portal>
  );
}

export function MenuItem({
  className,
  destructive = false,
  shortcut,
  children,
  ...props
}: ComponentProps<typeof DropdownMenu.Item> & {
  destructive?: boolean;
  shortcut?: readonly string[];
}) {
  return (
    <DropdownMenu.Item
      className={cx(
        menuItem,
        destructive && 'text-error-fg data-[highlighted]:bg-error-subtle',
        className,
      )}
      {...props}
    >
      {children}
      {shortcut && <Shortcut keys={shortcut} className="ml-auto pl-4" />}
    </DropdownMenu.Item>
  );
}

export function MenuLabel({
  className,
  ...props
}: ComponentProps<typeof DropdownMenu.Label>) {
  return (
    <DropdownMenu.Label
      className={cx('px-2 py-1 text-xs text-fg-muted', className)}
      {...props}
    />
  );
}

export function MenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenu.Separator>) {
  return (
    <DropdownMenu.Separator
      className={cx('my-1 h-px bg-line', className)}
      {...props}
    />
  );
}
