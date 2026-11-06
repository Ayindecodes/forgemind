'use client';

import { CircleAlert, Inbox, Lock, RefreshCw } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cx } from '@/lib/cx';

type StateProps = {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
};

function Frame({
  icon,
  tone = 'neutral',
  title,
  description,
  children,
  className,
  ...props
}: StateProps & {
  tone?: 'neutral' | 'error';
  children?: ReactNode;
  role?: string;
}) {
  return (
    <div
      className={cx(
        'flex flex-col items-center gap-3 px-6 py-10 text-center',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cx(
          'flex size-10 items-center justify-center rounded-lg *:size-5',
          tone === 'error'
            ? 'bg-error-subtle text-error-fg'
            : 'bg-surface text-fg-secondary',
        )}
      >
        {icon}
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="font-medium">{title}</p>
        {description && (
          <p className="text-sm text-fg-secondary">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}

export function EmptyState({ icon = <Inbox />, action, ...props }: StateProps) {
  return (
    <Frame icon={icon} {...props}>
      {action}
    </Frame>
  );
}

export function NoAccessState({
  icon = <Lock />,
  title = "You don't have access",
  action,
  ...props
}: Partial<StateProps>) {
  return (
    <Frame icon={icon} title={title} {...props}>
      {action}
    </Frame>
  );
}

type ErrorStateProps = Omit<StateProps, 'icon'> & {
  /** Raw detail, such as a message or a trace, shown on request. */
  details?: string;
  /** Runs when the user retries. The button stays busy until it settles. */
  onRetry?: () => void | Promise<void>;
};

export function ErrorState({
  title = 'Something went wrong',
  description,
  details,
  onRetry,
  action,
  className,
}: Partial<ErrorStateProps>) {
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    if (!onRetry) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <Frame
      role="alert"
      tone="error"
      icon={<CircleAlert />}
      title={title}
      description={description}
      className={className}
    >
      {(onRetry || action) && (
        <div className="flex gap-2">
          {onRetry && (
            <Button icon={<RefreshCw />} loading={retrying} onClick={retry}>
              Try again
            </Button>
          )}
          {action}
        </div>
      )}
      {details && (
        <details className="w-full max-w-lg text-left">
          <summary className="cursor-pointer text-sm text-fg-secondary">
            Details
          </summary>
          <pre className="material-solid mt-2 overflow-auto p-3 font-mono text-code whitespace-pre-wrap text-fg-secondary">
            {details}
          </pre>
        </details>
      )}
    </Frame>
  );
}
