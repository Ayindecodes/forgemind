'use client';

import { X } from 'lucide-react';
import { AlertDialog, Dialog as RadixDialog } from 'radix-ui';
import { useState, type ComponentProps, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { cx } from '@/lib/cx';

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

/** The dimmed layer behind anything modal. */
export const dialogOverlay =
  'material-scrim fixed inset-0 z-40 data-[state=open]:motion-fade-in data-[state=closed]:motion-fade-out';

const panel =
  'material-overlay fixed top-1/2 left-1/2 z-50 w-[calc(100%-3rem)] max-w-md -translate-x-1/2 -translate-y-1/2 p-5 outline-none data-[state=open]:motion-panel-in data-[state=closed]:motion-panel-out';

type DialogContentProps = Omit<
  ComponentProps<typeof RadixDialog.Content>,
  'title'
> & {
  title: ReactNode;
  description?: ReactNode;
};

export function DialogContent({
  title,
  description,
  className,
  children,
  ...props
}: DialogContentProps) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className={dialogOverlay} />
      <RadixDialog.Content
        aria-modal="true"
        className={cx(panel, className)}
        {...(description ? {} : { 'aria-describedby': undefined })}
        {...props}
      >
        <RadixDialog.Title className="pr-8 text-md font-semibold">
          {title}
        </RadixDialog.Title>
        {description && (
          <RadixDialog.Description className="mt-1 text-fg-secondary">
            {description}
          </RadixDialog.Description>
        )}
        <div className="mt-4">{children}</div>
        <RadixDialog.Close asChild>
          <IconButton
            label="Close"
            variant="ghost"
            size="sm"
            icon={<X />}
            className="absolute top-3 right-3"
          />
        </RadixDialog.Close>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

type ConfirmDialogProps = {
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm action as dangerous and starts focus on Cancel. */
  destructive?: boolean;
  /** Runs when confirmed. The dialog stays open, with the button busy, until it settles. */
  onConfirm: () => void | Promise<void>;
};

export function ConfirmDialog({
  trigger,
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const isOpen = open ?? internalOpen;

  const setOpen = (next: boolean) => {
    setInternalOpen(next);
    onOpenChange?.(next);
  };

  const confirm = async () => {
    setPending(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog.Root open={isOpen} onOpenChange={setOpen}>
      {trigger && <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger>}
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={dialogOverlay} />
        <AlertDialog.Content aria-modal="true" className={panel}>
          <AlertDialog.Title className="text-md font-semibold">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-1 text-fg-secondary">
            {description}
          </AlertDialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button disabled={pending}>{cancelLabel}</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button
                variant={destructive ? 'danger' : 'primary'}
                loading={pending}
                onClick={(event) => {
                  event.preventDefault();
                  void confirm();
                }}
              >
                {confirmLabel}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
