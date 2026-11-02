'use client';

import { Tooltip as RadixTooltip } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';

import { riseFromSide } from '@/components/ui/floating';
import { cx } from '@/lib/cx';

type TooltipProps = {
  content: ReactNode;
  side?: ComponentProps<typeof RadixTooltip.Content>['side'];
  children: ReactNode;
};

export function Tooltip({ content, side = 'top', children }: TooltipProps) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className={cx(
            'material-popover z-50 rounded-md px-2 py-1 text-xs text-fg data-[state=closed]:motion-popover-out data-[state=delayed-open]:motion-popover-in data-[state=instant-open]:motion-fade-in',
            riseFromSide,
          )}
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
