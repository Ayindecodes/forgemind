'use client';

import { Check } from 'lucide-react';
import { Checkbox as RadixCheckbox, Switch as RadixSwitch } from 'radix-ui';
import { useId, type ComponentProps } from 'react';

import { cx } from '@/lib/cx';

type Labelled = { label: string; description?: string; className?: string };

function Caption({ id, label, description }: Labelled & { id: string }) {
  return (
    <span className="flex flex-col">
      <label htmlFor={id} className="text-base leading-5 select-none">
        {label}
      </label>
      {description && (
        <span className="text-sm text-fg-secondary">{description}</span>
      )}
    </span>
  );
}

export function Checkbox({
  label,
  description,
  className,
  id: givenId,
  ...props
}: ComponentProps<typeof RadixCheckbox.Root> & Labelled) {
  const generatedId = useId();
  const id = givenId ?? generatedId;

  return (
    <div className={cx('flex items-start gap-2', className)}>
      <RadixCheckbox.Root
        id={id}
        className="press mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border pointer-coarse:size-6 border-line-control bg-elevated text-on-accent transition-colors hover:border-fg-muted disabled:pointer-events-none disabled:opacity-50 data-[state=checked]:border-accent data-[state=checked]:bg-accent"
        {...props}
      >
        <RadixCheckbox.Indicator>
          <Check aria-hidden="true" className="size-3" strokeWidth={3} />
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      <Caption id={id} label={label} description={description} />
    </div>
  );
}

export function Switch({
  label,
  description,
  className,
  id: givenId,
  ...props
}: ComponentProps<typeof RadixSwitch.Root> & Labelled) {
  const generatedId = useId();
  const id = givenId ?? generatedId;

  return (
    <div className={cx('flex items-start gap-2', className)}>
      <RadixSwitch.Root
        id={id}
        className="press relative h-5 w-9 shrink-0 rounded-full border border-line-control bg-surface pointer-coarse:h-9 pointer-coarse:w-15 transition-colors hover:border-fg-muted disabled:pointer-events-none disabled:opacity-50 data-[state=checked]:border-accent data-[state=checked]:bg-accent"
        {...props}
      >
        <RadixSwitch.Thumb className="block size-3.5 translate-x-0.5 rounded-full bg-fg-secondary transition-transform pointer-coarse:size-7 data-[state=checked]:translate-x-4.5 data-[state=checked]:bg-on-accent pointer-coarse:data-[state=checked]:translate-x-7" />
      </RadixSwitch.Root>
      <Caption id={id} label={label} description={description} />
    </div>
  );
}
