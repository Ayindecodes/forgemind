'use client';

import {
  Check,
  Monitor,
  Moon,
  Search,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Dialog } from 'radix-ui';
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';

import { dialogOverlay } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import {
  groupCommands,
  matchCommands,
  stepCommand,
  type Command,
} from '@/lib/commands';
import { designNav, primaryNav, secondaryNav } from '@/lib/navigation';
import { setThemePreference, type ThemePreference } from '@/lib/theme';
import { isModifierShortcut } from '@/lib/use-modifier-key';
import { useReturnFocus } from '@/lib/use-return-focus';
import { useThemePreference } from '@/lib/use-theme-preference';

type PaletteCommand = Command & {
  icon: LucideIcon;
  /** Marks the option that is already in effect, such as the current theme. */
  current?: boolean;
  run: () => void;
};

const themes: {
  preference: ThemePreference;
  label: string;
  icon: LucideIcon;
}[] = [
  { preference: 'system', label: 'Use system theme', icon: Monitor },
  { preference: 'dark', label: 'Use dark theme', icon: Moon },
  { preference: 'light', label: 'Use light theme', icon: Sun },
];

const panel =
  'material-overlay fixed top-[12vh] left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 flex-col overflow-hidden outline-none data-[state=open]:motion-panel-in data-[state=closed]:motion-panel-out';

function useCommands(withDesignPages: boolean): PaletteCommand[] {
  const router = useRouter();
  const theme = useThemePreference();

  return useMemo(
    () => [
      ...[...primaryNav, ...secondaryNav].map(
        ({ href, label, icon, keywords }) => ({
          id: `go-${href}`,
          group: 'Go to',
          label,
          icon,
          keywords,
          run: () => router.push(href),
        }),
      ),
      ...themes.map(({ preference, label, icon }) => ({
        id: `theme-${preference}`,
        group: 'Theme',
        label,
        icon,
        keywords: ['appearance', 'mode'],
        current: theme === preference,
        run: () => setThemePreference(preference),
      })),
      ...(withDesignPages
        ? designNav.map(({ href, label, icon, keywords }) => ({
            id: `design-${href}`,
            group: 'Design system',
            label,
            icon,
            keywords,
            run: () => router.push(href),
          }))
        : []),
    ],
    [router, theme, withDesignPages],
  );
}

/**
 * Search for any page or action and run it from the keyboard. Opens with ⌘K or
 * Ctrl+K from anywhere in the app, and the same shortcut closes it.
 */
export function CommandPalette({
  open,
  onOpenChange,
  designPages: withDesignPages,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Lists the design pages, in builds where they exist. */
  designPages: boolean;
}) {
  const commands = useCommands(withDesignPages);
  const returnFocus = useReturnFocus();

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isModifierShortcut(event, 'k')) return;

      event.preventDefault();
      onOpenChange(!open);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  const run = (command: PaletteCommand) => {
    onOpenChange(false);
    command.run();
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content
          aria-modal="true"
          aria-describedby={undefined}
          data-testid="command-palette"
          className={panel}
          {...returnFocus}
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          {/* Unmounts on close, so every opening starts with a fresh search. */}
          <PaletteSearch commands={commands} onRun={run} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PaletteSearch({
  commands,
  onRun,
}: {
  commands: PaletteCommand[];
  onRun: (command: PaletteCommand) => void;
}) {
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string>();
  const id = useId();
  const listboxId = `${id}-listbox`;
  const optionId = (command: Command) => `${id}-${command.id}`;

  const results = useMemo(
    () => matchCommands(commands, query),
    [commands, query],
  );
  const active =
    results.find((command) => command.id === activeId) ?? results[0];
  const activeOptionId = active && optionId(active);
  const expanded = results.length > 0;

  useEffect(() => {
    if (!activeOptionId) return;

    document
      .getElementById(activeOptionId)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeOptionId]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveId(stepCommand(results, active, step)?.id);
    } else if (event.key === 'Enter' && active) {
      event.preventDefault();
      onRun(active);
    }
  };

  return (
    <>
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
        <input
          type="text"
          role="combobox"
          aria-label="Search commands"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? listboxId : undefined}
          aria-activedescendant={activeOptionId}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search or jump to…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveId(undefined);
          }}
          onKeyDown={onKeyDown}
          className="h-12 min-w-0 flex-1 bg-transparent text-md text-fg outline-none placeholder:text-fg-muted"
        />
      </div>

      {expanded && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Commands"
          // Keeps focus in the search field when an option is clicked.
          onMouseDown={(event) => event.preventDefault()}
          className="max-h-80 scroll-py-1.5 overflow-y-auto overscroll-contain p-1.5"
        >
          {groupCommands(results).map(({ name, items }, index) => (
            <div
              key={name}
              role="group"
              aria-labelledby={`${id}-group-${index}`}
            >
              <div
                id={`${id}-group-${index}`}
                aria-hidden="true"
                className="px-2.5 pt-2 pb-1 text-xs font-medium text-fg-muted"
              >
                {name}
              </div>
              {items.map((command) => {
                const Icon = command.icon;

                return (
                  <div
                    key={command.id}
                    id={optionId(command)}
                    role="option"
                    aria-selected={command === active}
                    onPointerMove={() => setActiveId(command.id)}
                    onClick={() => onRun(command)}
                    className="flex h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 text-fg-secondary select-none aria-selected:bg-hover aria-selected:text-fg"
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0" />
                    <span className="flex-1 truncate">
                      {command.label}
                      {command.current && (
                        <span className="sr-only"> (current)</span>
                      )}
                    </span>
                    {command.current && (
                      <Check
                        aria-hidden="true"
                        className="size-4 shrink-0 text-accent-fg"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <div
        role="status"
        className={
          expanded ? 'sr-only' : 'px-4 py-10 text-center text-fg-secondary'
        }
      >
        {expanded ? '' : `No results for “${query.trim()}”`}
      </div>

      <div
        aria-hidden="true"
        className="flex items-center gap-4 border-t border-line px-4 py-2 text-xs text-fg-muted"
      >
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          to move
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd>
          to run
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>Esc</Kbd>
          to close
        </span>
      </div>
    </>
  );
}
