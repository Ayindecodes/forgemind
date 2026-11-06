'use client';

import type { Repository, Task } from '@forgemind/contract';
import { Command } from 'cmdk';
import {
  FolderGit2,
  Keyboard,
  ListChecks,
  LogOut,
  Monitor,
  Moon,
  PanelLeft,
  Plus,
  Sun,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Dialog } from 'radix-ui';
import type { RefObject } from 'react';

import { Badge } from '@/components/ui/badge';
import { Kbd } from '@/components/ui/kbd';
import { Status, type StatusValue } from '@/components/ui/status';
import { cx } from '@/lib/cx';
import { useRepositories, useSignOut, useTasks } from '@/lib/queries';
import { readSidebarMode, setSidebarMode } from '@/lib/sidebar';
import { formatKeys, shortcutById, type ShortcutId } from '@/lib/shortcuts';
import { setThemePreference, type ThemePreference } from '@/lib/theme';
import { useModifierKey } from '@/lib/use-modifier-key';

import { navItems } from './nav';

const taskStatus: Record<Task['status'], StatusValue> = {
  queued: 'pending',
  running: 'running',
  awaiting_approval: 'awaiting',
  completed: 'passed',
  failed: 'failed',
  cancelled: 'cancelled',
};

const item =
  'flex h-9 cursor-default items-center gap-3 rounded-md px-2.5 text-sm outline-none select-none data-[selected=true]:bg-hover data-[disabled=true]:opacity-50';

function Hint({ id }: { id: ShortcutId }) {
  const mod = useModifierKey();
  const shortcut = shortcutById(id);
  if (!shortcut) return null;

  return (
    <span className="ml-auto flex items-center gap-1 pl-4" aria-hidden="true">
      {formatKeys(shortcut.keys, mod).map((chord, index) => (
        <span key={index} className="flex items-center gap-0.5">
          {index > 0 && (
            <span className="px-0.5 text-xs text-fg-muted">then</span>
          )}
          {chord.map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
        </span>
      ))}
    </span>
  );
}

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShowHelp: () => void;
  /** Where focus goes back to when the palette closes. */
  opener: RefObject<HTMLElement | null>;
};

export function CommandPalette({
  open,
  onOpenChange,
  onShowHelp,
  opener,
}: CommandPaletteProps) {
  const router = useRouter();
  const repositories = useRepositories(open);
  const tasks = useTasks(open);
  const signOut = useSignOut();

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };
  const act = (action: () => void) => {
    onOpenChange(false);
    action();
  };

  const repoItems: Repository[] = (repositories.data?.items ?? []).filter(
    ({ status }) => status !== 'revoked',
  );
  const taskItems: Task[] = tasks.data?.items ?? [];
  const loading = open && (repositories.isPending || tasks.isPending);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="material-scrim fixed inset-0 z-40 data-[state=closed]:motion-fade-out data-[state=open]:motion-fade-in" />
        <Dialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            // Radix loses the opener behind the exit animation; restore it ourselves.
            event.preventDefault();
            opener.current?.focus();
          }}
          className="material-overlay fixed top-[12vh] left-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden p-0 outline-none data-[state=closed]:motion-panel-out data-[state=open]:motion-panel-in"
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Command
            label="Command palette"
            // cmdk binds Ctrl+K to "previous item"; here Ctrl+K toggles the palette.
            vimBindings={false}
            loop
            className="flex flex-col"
          >
            <Command.Input
              placeholder="Search repositories, tasks and actions"
              data-testid="palette-input"
              className="h-12 w-full border-b border-line bg-transparent px-4 text-base outline-none placeholder:text-fg-muted"
            />
            <Command.List className="max-h-[min(24rem,60vh)] overflow-auto p-2 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-fg-muted">
              {loading && (
                <Command.Loading>
                  <div className="px-2.5 py-2 text-sm text-fg-secondary">
                    Loading
                  </div>
                </Command.Loading>
              )}
              <Command.Empty className="px-2.5 py-6 text-center text-sm text-fg-secondary">
                No results.
              </Command.Empty>

              <Command.Group heading="Go to">
                {navItems.map(({ href, label, icon: Icon }) => (
                  <Command.Item
                    key={href}
                    value={label}
                    onSelect={() => go(href)}
                    className={item}
                  >
                    <Icon aria-hidden="true" className="size-4 text-fg-muted" />
                    {label}
                  </Command.Item>
                ))}
              </Command.Group>

              <Command.Group heading="Repositories">
                {repoItems.map((repo) => (
                  <Command.Item
                    key={repo.id}
                    value={repo.fullName}
                    keywords={[repo.id]}
                    onSelect={() => go(`/repositories/${repo.id}`)}
                    className={item}
                  >
                    <FolderGit2
                      aria-hidden="true"
                      className="size-4 text-fg-muted"
                    />
                    <span className="truncate font-mono text-code">
                      {repo.fullName}
                    </span>
                    {repo.status !== 'connected' && (
                      <Badge
                        tone={repo.status === 'error' ? 'error' : 'neutral'}
                        className="ml-auto"
                      >
                        {repo.status}
                      </Badge>
                    )}
                  </Command.Item>
                ))}
              </Command.Group>

              <Command.Group heading="Tasks">
                {taskItems.map((task) => (
                  <Command.Item
                    key={task.id}
                    value={task.title}
                    keywords={[task.id, task.repositoryId]}
                    onSelect={() => go(`/tasks/${task.id}`)}
                    className={item}
                  >
                    <ListChecks
                      aria-hidden="true"
                      className="size-4 shrink-0 text-fg-muted"
                    />
                    <span className="truncate">{task.title}</span>
                    <Status
                      status={taskStatus[task.status]}
                      size="sm"
                      iconOnly
                      className="ml-auto"
                    />
                  </Command.Item>
                ))}
              </Command.Group>

              <Command.Group heading="Actions">
                <Command.Item
                  value="New task"
                  onSelect={() => go('/tasks/new')}
                  className={item}
                >
                  <Plus aria-hidden="true" className="size-4 text-fg-muted" />
                  New task
                  <Hint id="newTask" />
                </Command.Item>
                {(
                  [
                    ['system', Monitor],
                    ['dark', Moon],
                    ['light', Sun],
                  ] as const
                ).map(([preference, Icon]) => (
                  <Command.Item
                    key={preference}
                    value={`Theme: ${preference}`}
                    onSelect={() =>
                      act(() =>
                        setThemePreference(preference as ThemePreference),
                      )
                    }
                    className={cx(item, 'capitalize')}
                  >
                    <Icon aria-hidden="true" className="size-4 text-fg-muted" />
                    Theme: {preference}
                  </Command.Item>
                ))}
                <Command.Item
                  value="Collapse or expand the sidebar"
                  onSelect={() =>
                    act(() =>
                      setSidebarMode(
                        readSidebarMode() === 'compact'
                          ? 'expanded'
                          : 'compact',
                      ),
                    )
                  }
                  className={item}
                >
                  <PanelLeft
                    aria-hidden="true"
                    className="size-4 text-fg-muted"
                  />
                  Collapse or expand the sidebar
                  <Hint id="sidebar" />
                </Command.Item>
                <Command.Item
                  value="Keyboard shortcuts"
                  onSelect={onShowHelp}
                  className={item}
                >
                  <Keyboard
                    aria-hidden="true"
                    className="size-4 text-fg-muted"
                  />
                  Keyboard shortcuts
                  <Hint id="help" />
                </Command.Item>
                <Command.Item
                  value="Sign out"
                  onSelect={() =>
                    act(() =>
                      signOut.mutate(undefined, {
                        onSuccess: () => router.push('/sign-in'),
                      }),
                    )
                  }
                  className={item}
                >
                  <LogOut aria-hidden="true" className="size-4 text-fg-muted" />
                  Sign out
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
