import { afterAll, describe, expect, it } from 'vitest';
import { buildAuthContext } from '../src/lib/auth/context';
import { activeProviderType } from '../src/lib/auth/config';
import type { AuthProviderType } from '../src/lib/auth/types';

// The provider-swap guarantee at the canonical boundary: whatever the active provider, the SAME
// verified identity collapses to the SAME AuthContext shape (role pinned null in Phase A). The
// API/core never branch on providerType — they consume only orgId (+ approver). Flipping
// AUTH_PROVIDER selects a different provider with zero downstream change.
const identity = { userId: 'u-1', email: 'a@b.com', displayName: 'Ada' };

describe('AUTH_PROVIDER swaps the provider with no core/api change', () => {
  const saved = process.env['AUTH_PROVIDER'];
  afterAll(() => {
    if (saved === undefined) delete process.env['AUTH_PROVIDER'];
    else process.env['AUTH_PROVIDER'] = saved;
  });

  it.each<[AuthProviderType, string]>([
    ['clerk', 'org_from_clerk_session'],
    ['oidc', 'org_workspace'],
    ['local', 'org_workspace'],
  ])('%s yields a canonical AuthContext (role null, orgId carried)', (type, orgId) => {
    process.env['AUTH_PROVIDER'] = type;
    expect(activeProviderType()).toBe(type);

    const ctx = buildAuthContext(type, identity, orgId);
    expect(ctx).toEqual({
      userId: 'u-1',
      orgId,
      email: 'a@b.com',
      displayName: 'Ada',
      providerType: type,
      role: null,
    });
    // Phase A invariant: role is shaped but NEVER populated/enforced.
    expect(ctx.role).toBeNull();
  });
});
