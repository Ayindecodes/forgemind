'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { timeouts } from '@/lib/motion';
import { readSidebarMode, setSidebarMode } from '@/lib/sidebar';
import {
  goTargets,
  isEditableTarget,
  ShortcutMatcher,
  shortcuts,
  type ShortcutId,
} from '@/lib/shortcuts';

import { CommandPalette } from './command-palette';
import { ShortcutHelp } from './shortcut-help';
import { COMMAND_PALETTE_EVENT } from './top-bar';

type CommandCenterValue = {
  openPalette: () => void;
  openHelp: () => void;
};

const CommandCenterContext = createContext<CommandCenterValue | null>(null);

export function useCommandCenter() {
  const value = useContext(CommandCenterContext);
  if (!value)
    throw new Error('useCommandCenter needs a CommandCenter above it');
  return value;
}

/** Owns the command palette, the shortcut help, and the global key listener. */
export function CommandCenter({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const paletteOpenRef = useRef(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const matcher = useRef(new ShortcutMatcher(shortcuts, timeouts.keySequence));
  const opener = useRef<HTMLElement | null>(null);

  const openPalette = useCallback(() => {
    opener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setPaletteOpen(true);
  }, []);

  const run = useCallback(
    (id: ShortcutId) => {
      const target = goTargets[id];
      if (target) {
        router.push(target);
        return;
      }

      switch (id) {
        case 'palette':
          if (paletteOpenRef.current) setPaletteOpen(false);
          else openPalette();
          break;
        case 'help':
          setHelpOpen(true);
          break;
        case 'sidebar':
          setSidebarMode(
            readSidebarMode() === 'compact' ? 'expanded' : 'compact',
          );
          break;
        case 'newTask':
          router.push('/tasks/new');
          break;
      }
    },
    [router, openPalette],
  );

  useEffect(() => {
    paletteOpenRef.current = paletteOpen;
  }, [paletteOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const id = matcher.current.handle(event, {
        editable: isEditableTarget(event.target),
        now: Date.now(),
      });
      if (!id) return;

      event.preventDefault();
      run(id);
    };
    const onOpen = () => openPalette();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(COMMAND_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(COMMAND_PALETTE_EVENT, onOpen);
    };
  }, [run, openPalette]);

  const value: CommandCenterValue = {
    openPalette,
    openHelp: () => setHelpOpen(true),
  };

  return (
    <CommandCenterContext.Provider value={value}>
      {children}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onShowHelp={() => {
          setPaletteOpen(false);
          setHelpOpen(true);
        }}
        opener={opener}
      />
      <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </CommandCenterContext.Provider>
  );
}
