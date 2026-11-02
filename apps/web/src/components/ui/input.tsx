'use client';

import type {
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react';

import { useFieldControl } from '@/components/ui/field';
import { cx } from '@/lib/cx';

export const controlBase =
  'w-full min-w-0 rounded-md border border-line-control bg-elevated text-base text-fg transition-colors placeholder:text-fg-muted hover:border-fg-muted disabled:pointer-events-none disabled:opacity-50 aria-[invalid=true]:border-error-fg';

type InputProps = InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode };

export function Input({ icon, className, ...props }: InputProps) {
  const control = useFieldControl();
  const input = (
    <input
      className={cx(
        controlBase,
        'h-8 px-2.5',
        icon ? 'pl-8' : undefined,
        className,
      )}
      {...control}
      {...props}
    />
  );

  if (!icon) return input;

  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-fg-muted *:size-4"
      >
        {icon}
      </span>
      {input}
    </div>
  );
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const control = useFieldControl();

  return (
    <textarea
      className={cx(controlBase, 'min-h-20 px-2.5 py-1.5', className)}
      {...control}
      {...props}
    />
  );
}
