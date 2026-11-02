'use client';

import { CircleAlert } from 'lucide-react';
import { createContext, useContext, useId, type ReactNode } from 'react';

import { cx } from '@/lib/cx';

type FieldContextValue = {
  id: string;
  descriptionId?: string;
  errorId?: string;
  invalid: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

/** The attributes a control needs to be labelled and described by its Field. */
export function useFieldControl() {
  const field = useContext(FieldContext);
  if (!field) return {};

  const describedBy = [field.descriptionId, field.errorId]
    .filter(Boolean)
    .join(' ');

  return {
    id: field.id,
    'aria-describedby': describedBy || undefined,
    'aria-invalid': field.invalid || undefined,
  };
}

export function Field({
  label,
  description,
  error,
  className,
  children,
}: {
  label: string;
  description?: string;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const descriptionId = description && !error ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <FieldContext.Provider
      value={{ id, descriptionId, errorId, invalid: Boolean(error) }}
    >
      <div className={cx('flex flex-col gap-1.5', className)}>
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {children}
        {descriptionId && (
          <p id={descriptionId} className="text-sm text-fg-secondary">
            {description}
          </p>
        )}
        {errorId && (
          <p
            id={errorId}
            role="alert"
            className="flex items-center gap-1 text-sm text-error-fg"
          >
            <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}
