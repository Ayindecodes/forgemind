'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { IconButton } from '@/components/ui/icon-button';
import { timeouts } from '@/lib/motion';
import { toast } from '@/lib/toast';

export function CopyButton({
  text,
  label = 'Copy',
  className,
  disabled,
}: {
  /** The text, or a function that builds it only when the button is used. */
  text: string | (() => string);
  label?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        typeof text === 'function' ? text() : text,
      );
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), timeouts.copied);
    } catch {
      toast({
        tone: 'error',
        title: 'Copy failed',
        description: 'The browser blocked clipboard access.',
      });
    }
  };

  return (
    <>
      <IconButton
        label={copied ? 'Copied' : label}
        icon={copied ? <Check /> : <Copy />}
        variant="ghost"
        size="sm"
        onClick={copy}
        disabled={disabled}
        className={className}
        data-copied={copied || undefined}
      />
      <span role="status" className="sr-only">
        {copied ? 'Copied to clipboard' : ''}
      </span>
    </>
  );
}
