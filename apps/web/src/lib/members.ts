import type { Role } from '@forgemind/contract';

/*
 * Who may do what to members. Owners and admins manage; only owners touch
 * owners; the last owner stays. The API enforces the same rules.
 */

export const roleLabels: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  developer: 'Developer',
  reviewer: 'Reviewer',
  viewer: 'Viewer',
};

export const roleHelp: Record<Role, string> = {
  owner: 'Everything, including ownership and billing.',
  admin: 'Manages members, repositories and tasks.',
  developer:
    'Starts and cancels tasks, connects repositories, opens pull requests.',
  reviewer: 'Approves, rejects or sends back results.',
  viewer: 'Reads everything, changes nothing.',
};

export const roles: Role[] = [
  'owner',
  'admin',
  'developer',
  'reviewer',
  'viewer',
];

export const canManageMembers = (role: Role | null | undefined) =>
  role === 'owner' || role === 'admin';

export function canChangeRole(
  actor: Role | null | undefined,
  target: Role,
  to: Role,
  owners: number,
) {
  if (!canManageMembers(actor)) return false;
  if ((target === 'owner' || to === 'owner') && actor !== 'owner') return false;
  if (target === 'owner' && to !== 'owner' && owners <= 1) return false;
  return true;
}

export function canRemove(
  actor: Role | null | undefined,
  target: Role,
  owners: number,
) {
  if (!canManageMembers(actor)) return false;
  if (target === 'owner' && actor !== 'owner') return false;
  if (target === 'owner' && owners <= 1) return false;
  return true;
}
