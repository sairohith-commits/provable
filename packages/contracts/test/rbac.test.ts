import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLES, type Permission, type Role, can, permissionsFor } from '../src/rbac.js';

// The authoritative permission matrix (PROVABLE governance spec). Both the web (UX) and the
// API (enforcement) import can() from here, so this lockstep IS the matrix contract.
const EXPECTED: Record<Role, readonly Permission[]> = {
  OWNER: [...PERMISSIONS],
  APPROVER: ['view', 'approve_transition', 'free_set_mode', 'suspend_agent', 'activate_deactivate'],
  OPERATOR: ['view', 'activate_deactivate'],
  VIEWER: ['view'],
};

describe('RBAC permission matrix', () => {
  it('exposes exactly the four roles', () => {
    expect([...ROLES]).toEqual(['OWNER', 'APPROVER', 'OPERATOR', 'VIEWER']);
  });

  it.each(ROLES)('%s grants exactly its matrix permissions and denies the rest', (role) => {
    const allowed = new Set(EXPECTED[role]);
    for (const perm of PERMISSIONS) {
      expect(can(role, perm)).toBe(allowed.has(perm));
    }
    expect([...permissionsFor(role)].sort()).toEqual([...allowed].sort());
  });

  it('OWNER holds every permission; VIEWER holds only view', () => {
    for (const perm of PERMISSIONS) expect(can('OWNER', perm)).toBe(true);
    expect(can('VIEWER', 'view')).toBe(true);
    expect(can('VIEWER', 'approve_transition')).toBe(false);
  });

  it('only OWNER/APPROVER may approve; only OWNER may manage keys/people', () => {
    expect(can('OWNER', 'approve_transition')).toBe(true);
    expect(can('APPROVER', 'approve_transition')).toBe(true);
    expect(can('OPERATOR', 'approve_transition')).toBe(false);
    expect(can('VIEWER', 'approve_transition')).toBe(false);
    for (const role of ['APPROVER', 'OPERATOR', 'VIEWER'] as const) {
      expect(can(role, 'manage_keys')).toBe(false);
      expect(can(role, 'manage_people')).toBe(false);
    }
  });

  it('activate_deactivate is OWNER/APPROVER/OPERATOR (not VIEWER)', () => {
    expect(can('OWNER', 'activate_deactivate')).toBe(true);
    expect(can('APPROVER', 'activate_deactivate')).toBe(true);
    expect(can('OPERATOR', 'activate_deactivate')).toBe(true);
    expect(can('VIEWER', 'activate_deactivate')).toBe(false);
  });
});
