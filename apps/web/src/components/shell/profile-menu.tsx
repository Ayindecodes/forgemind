'use client';

import {
  ChevronDown,
  Keyboard,
  LogOut,
  Monitor,
  Moon,
  Sun,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Avatar } from '@/components/ui/avatar';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession, useSignOut } from '@/lib/queries';
import {
  setThemePreference,
  themePreferences,
  type ThemePreference,
} from '@/lib/theme';
import { useThemePreference } from '@/lib/use-theme-preference';

import { useCommandCenter } from './command-center';

const themeIcons = { system: Monitor, dark: Moon, light: Sun } as const;

export function ProfileMenu() {
  const session = useSession();
  const signOut = useSignOut();
  const theme = useThemePreference();
  const { openHelp } = useCommandCenter();
  const router = useRouter();
  const user = session.data?.user;

  if (!user) return <Skeleton className="h-8 w-8 rounded-full" />;

  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account, ${user.name}`}
          data-testid="profile-trigger"
          className="press flex h-8 items-center gap-1.5 rounded-full pr-1.5 pl-0.5 transition-colors hover:bg-hover"
        >
          <Avatar name={user.name} />
          <ChevronDown aria-hidden="true" className="size-3.5 text-fg-muted" />
        </button>
      </MenuTrigger>
      <MenuContent align="end" className="min-w-56">
        <MenuLabel className="flex flex-col gap-0.5 py-1.5">
          <span className="text-sm font-medium text-fg">{user.name}</span>
          <span className="font-mono text-code text-fg-secondary">
            {user.email}
          </span>
        </MenuLabel>
        <MenuSeparator />
        <MenuLabel>Theme</MenuLabel>
        <MenuRadioGroup
          value={theme}
          onValueChange={(value) =>
            setThemePreference(value as ThemePreference)
          }
        >
          {themePreferences.map((preference) => {
            const Icon = themeIcons[preference];
            return (
              <MenuRadioItem
                key={preference}
                value={preference}
                className="capitalize"
              >
                <Icon aria-hidden="true" className="size-3.5 text-fg-muted" />
                {preference}
              </MenuRadioItem>
            );
          })}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem shortcut={['?']} onSelect={openHelp}>
          <Keyboard aria-hidden="true" className="size-3.5 text-fg-muted" />
          Keyboard shortcuts
        </MenuItem>
        <MenuItem
          onSelect={() =>
            signOut.mutate(undefined, {
              onSuccess: () => router.push('/sign-in'),
            })
          }
        >
          <LogOut aria-hidden="true" className="size-3.5 text-fg-muted" />
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
