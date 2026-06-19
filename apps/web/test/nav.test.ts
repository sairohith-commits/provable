import type { Role } from '@provable/contracts';
import { describe, expect, it } from 'vitest';
import { activeKey, navFor } from '../src/lib/nav';

const keysOf = (role: Role) => navFor(role).flatMap((s) => s.items.map((i) => i.key));

describe('navFor — Govern is view-level; Manage is role-gated', () => {
  it('OWNER sees every item (incl. Connectors — manage_agents)', () => {
    const keys = keysOf('OWNER');
    expect(keys).toEqual(
      expect.arrayContaining([
        'overview', 'activity', 'safety', 'cost', 'registry', 'connect', 'connectors', 'onboarding', 'agents', 'people',
      ]),
    );
  });

  it('VIEWER sees all Govern + only Connect under Manage (no connectors/onboarding/agents/people)', () => {
    const keys = keysOf('VIEWER');
    expect(keys).toEqual(expect.arrayContaining(['overview', 'activity', 'safety', 'cost', 'registry', 'connect']));
    expect(keys).not.toContain('connectors');
    expect(keys).not.toContain('onboarding');
    expect(keys).not.toContain('agents');
    expect(keys).not.toContain('people');
  });

  it('OPERATOR sees Agents (activate_deactivate) but not Connectors (manage_agents) or People', () => {
    const keys = keysOf('OPERATOR');
    expect(keys).toContain('agents');
    expect(keys).not.toContain('connectors'); // manage_agents is OWNER-only
    expect(keys).not.toContain('people');
  });

  it('groups are Govern then Manage, non-empty', () => {
    const groups = navFor('OWNER');
    expect(groups.map((g) => g.group)).toEqual(['Govern', 'Manage']);
  });
});

describe('activeKey — longest-prefix match; "/" only matches exactly', () => {
  it('maps pathnames to the active nav key', () => {
    expect(activeKey('/')).toBe('overview');
    expect(activeKey('/activity')).toBe('activity');
    expect(activeKey('/cost')).toBe('cost');
    expect(activeKey('/admin/agents')).toBe('agents');
    expect(activeKey('/admin/agents/sub')).toBe('agents');
    expect(activeKey('/people')).toBe('people');
    expect(activeKey('/connectors')).toBe('connectors');
  });
  it('an unknown path falls back to overview (never crashes)', () => {
    expect(activeKey('/nope')).toBe('overview');
  });
});
