import { describe, expect, it } from 'vitest';

import {
  canChangeRole,
  canManageMembers,
  canRemove,
  roleHelp,
  roles,
} from './members';

describe('member permissions', () => {
  it('lets only owners and admins manage', () => {
    expect(canManageMembers('owner')).toBe(true);
    expect(canManageMembers('admin')).toBe(true);
    expect(canManageMembers('developer')).toBe(false);
    expect(canManageMembers(null)).toBe(false);
  });

  it("keeps owners in owners' hands and keeps the last owner", () => {
    expect(canChangeRole('admin', 'developer', 'reviewer', 1)).toBe(true);
    expect(canChangeRole('admin', 'owner', 'admin', 2)).toBe(false);
    expect(canChangeRole('admin', 'developer', 'owner', 2)).toBe(false);
    expect(canChangeRole('owner', 'owner', 'admin', 2)).toBe(true);
    expect(canChangeRole('owner', 'owner', 'admin', 1)).toBe(false);
    expect(canRemove('owner', 'owner', 1)).toBe(false);
    expect(canRemove('owner', 'owner', 2)).toBe(true);
    expect(canRemove('admin', 'owner', 2)).toBe(false);
    expect(canRemove('admin', 'viewer', 1)).toBe(true);
  });

  it('explains every role', () => {
    for (const role of roles) expect(roleHelp[role]).toMatch(/\.$/);
  });
});
