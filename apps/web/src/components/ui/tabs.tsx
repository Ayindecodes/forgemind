'use client';

import { motion } from 'motion/react';
import { Tabs as RadixTabs } from 'radix-ui';
import {
  createContext,
  useContext,
  useId,
  useState,
  type ComponentProps,
} from 'react';

import { cx } from '@/lib/cx';

const TabsContext = createContext<{ value?: string; layoutId: string } | null>(
  null,
);

export function Tabs({
  value,
  defaultValue,
  onValueChange,
  children,
  ...props
}: ComponentProps<typeof RadixTabs.Root>) {
  const [internal, setInternal] = useState(defaultValue);
  const current = value ?? internal;
  const layoutId = useId();

  return (
    <RadixTabs.Root
      value={current}
      onValueChange={(next) => {
        setInternal(next);
        onValueChange?.(next);
      }}
      {...props}
    >
      <TabsContext.Provider value={{ value: current, layoutId }}>
        {children}
      </TabsContext.Provider>
    </RadixTabs.Root>
  );
}

export function TabsList({
  className,
  ...props
}: ComponentProps<typeof RadixTabs.List>) {
  return (
    <RadixTabs.List
      className={cx('flex gap-1 border-b border-line', className)}
      {...props}
    />
  );
}

export function TabsTrigger({
  value,
  className,
  children,
  ...props
}: ComponentProps<typeof RadixTabs.Trigger>) {
  const tabs = useContext(TabsContext);
  const active = tabs?.value === value;

  return (
    <RadixTabs.Trigger
      value={value}
      className={cx(
        'relative h-8 rounded-t-sm px-2.5 text-sm font-medium pointer-coarse:h-10 text-fg-secondary transition-colors hover:text-fg disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-fg',
        className,
      )}
      {...props}
    >
      {children}
      {active && tabs && (
        <motion.span
          layoutId={tabs.layoutId}
          aria-hidden="true"
          className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent"
        />
      )}
    </RadixTabs.Trigger>
  );
}

export function TabsContent({
  className,
  ...props
}: ComponentProps<typeof RadixTabs.Content>) {
  return (
    <RadixTabs.Content
      className={cx('pt-4 outline-none', className)}
      {...props}
    />
  );
}
