'use client';

import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { Toast as RadixToast } from 'radix-ui';
import { useRef, useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { cx } from '@/lib/cx';
import { durations, timeouts } from '@/lib/motion';
import {
  closeToast,
  getToasts,
  removeToast,
  subscribeToToasts,
  type ToastTone,
} from '@/lib/toast';

const icons = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleAlert,
};

const tones: Record<ToastTone, string> = {
  info: 'text-info-fg',
  success: 'text-success-fg',
  warning: 'text-warning-fg',
  error: 'text-error-fg',
};

const labels: Record<ToastTone, string> = {
  info: 'Notice',
  success: 'Success',
  warning: 'Warning',
  error: 'Error',
};

export function Toaster() {
  const toasts = useSyncExternalStore(subscribeToToasts, getToasts, getToasts);
  const viewportRef = useRef<HTMLOListElement>(null);

  const onClose = (id: number) => {
    closeToast(id);
    setTimeout(() => removeToast(id), durations.fast * 1000);

    // Radix parks focus on the viewport when a focused toast closes, and its
    // timers stay paused while focus is inside. Once nothing is left to read,
    // give focus back to the page so later toasts can leave on their own.
    const focused = document.activeElement;
    const othersOpen = getToasts().some((item) => item.open);
    if (
      !othersOpen &&
      focused instanceof HTMLElement &&
      viewportRef.current?.contains(focused)
    ) {
      focused.blur();
    }
  };

  return (
    <RadixToast.Provider duration={timeouts.toast} swipeDirection="right">
      {toasts.map(({ id, tone, title, description, action, open }) => {
        const Icon = icons[tone];

        return (
          <RadixToast.Root
            key={id}
            open={open}
            data-testid="toast"
            data-tone={tone}
            type={tone === 'error' ? 'foreground' : 'background'}
            onOpenChange={(next) => {
              if (!next) onClose(id);
            }}
            className="material-popover relative flex items-start gap-3 p-3 pr-9 text-sm [--motion-shift-y:var(--motion-shift)] data-[state=closed]:motion-fade-out data-[state=open]:motion-popover-in"
          >
            <Icon
              aria-hidden="true"
              className={cx('mt-0.5 size-4 shrink-0', tones[tone])}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <RadixToast.Title className="font-medium">
                <span className="sr-only">{labels[tone]}: </span>
                {title}
              </RadixToast.Title>
              {description && (
                <RadixToast.Description className="text-fg-secondary">
                  {description}
                </RadixToast.Description>
              )}
              {action && (
                <RadixToast.Action altText={action.label} asChild>
                  <Button
                    size="sm"
                    className="mt-1.5 self-start"
                    onClick={action.onClick}
                  >
                    {action.label}
                  </Button>
                </RadixToast.Action>
              )}
            </div>
            <RadixToast.Close asChild>
              <IconButton
                label="Dismiss"
                variant="ghost"
                size="sm"
                icon={<X />}
                tooltip={false}
                className="absolute top-1.5 right-1.5"
              />
            </RadixToast.Close>
          </RadixToast.Root>
        );
      })}
      <RadixToast.Viewport
        ref={viewportRef}
        className="fixed right-4 bottom-4 z-60 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none"
      />
    </RadixToast.Provider>
  );
}
