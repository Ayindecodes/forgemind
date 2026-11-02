'use client';

import { Check, ChevronDown } from 'lucide-react';
import { Select as RadixSelect } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';

import { useFieldControl } from '@/components/ui/field';
import { floating, menuItem, riseFromSide } from '@/components/ui/floating';
import { controlBase } from '@/components/ui/input';
import { cx } from '@/lib/cx';

type SelectProps = ComponentProps<typeof RadixSelect.Root> & {
  placeholder?: string;
  className?: string;
  'data-testid'?: string;
  children: ReactNode;
};

export function Select({
  placeholder,
  className,
  'data-testid': testId,
  children,
  ...props
}: SelectProps) {
  const control = useFieldControl();

  return (
    <RadixSelect.Root {...props}>
      <RadixSelect.Trigger
        className={cx(
          controlBase,
          'press inline-flex h-8 items-center justify-between gap-2 px-2.5 data-[placeholder]:text-fg-muted',
          className,
        )}
        data-testid={testId}
        {...control}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon className="text-fg-muted">
          <ChevronDown aria-hidden="true" className="size-4" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className={cx(
            floating,
            riseFromSide,
            'min-w-(--radix-select-trigger-width) p-1',
          )}
        >
          <RadixSelect.Viewport>{children}</RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof RadixSelect.Item>) {
  return (
    <RadixSelect.Item
      className={cx(menuItem, 'relative pl-7', className)}
      {...props}
    >
      <RadixSelect.ItemIndicator className="absolute left-2 flex">
        <Check aria-hidden="true" className="size-3.5" />
      </RadixSelect.ItemIndicator>
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
    </RadixSelect.Item>
  );
}
