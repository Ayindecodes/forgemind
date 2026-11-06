'use client';

import { Check, ChevronsUpDown } from 'lucide-react';

import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrganization, useSession } from '@/lib/queries';

export function OrgMenu() {
  const organization = useOrganization();
  const session = useSession();
  const org = organization.data;

  if (!org) return <Skeleton className="h-6 w-32" />;

  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          data-testid="org-trigger"
          className="press flex h-8 max-w-56 items-center pointer-coarse:h-10 gap-1.5 rounded-md px-2 text-sm font-medium transition-colors hover:bg-hover"
        >
          <span className="truncate">{org.name}</span>
          <ChevronsUpDown
            aria-hidden="true"
            className="size-3.5 shrink-0 text-fg-muted"
          />
        </button>
      </MenuTrigger>
      <MenuContent className="min-w-56">
        <MenuLabel>Organization</MenuLabel>
        <MenuItem className="justify-between">
          {org.name}
          <Check aria-hidden="true" className="size-3.5 text-accent-fg" />
        </MenuItem>
        {session.data?.role && (
          <MenuLabel className="capitalize">
            Your role: {session.data.role}
          </MenuLabel>
        )}
        <MenuSeparator />
        <MenuItem disabled>Create organization</MenuItem>
      </MenuContent>
    </Menu>
  );
}
