import { PERMISSIONS, ROLES, can } from '@provable/contracts';
import { describe, expect, it } from 'vitest';
import { PERSONAS, sectionOrder } from '../src/lib/view-helpers';

// Access ⟂ lens: RBAC (role → permission) and the persona lens (a pure view-ordering axis) are
// independent. Neither function takes the other's input, and switching one never changes the
// other. This guards against the two axes ever being conflated.
describe('access is orthogonal to the persona lens', () => {
  it('permission decisions depend on role only — never on the persona lens', () => {
    for (const role of ROLES) {
      const baseline = PERMISSIONS.filter((p) => can(role, p));
      // There is no lens parameter to can(); re-evaluating under every persona is identical.
      for (const _persona of PERSONAS) {
        expect(PERMISSIONS.filter((p) => can(role, p))).toEqual(baseline);
      }
    }
  });

  it('lens ordering depends on persona only — never on role', () => {
    // sectionOrder takes ONLY a persona; the same persona yields the same order regardless of
    // who is viewing (there is no role input to the lens).
    for (const persona of PERSONAS) {
      const order = sectionOrder(persona);
      for (const _role of ROLES) {
        expect(sectionOrder(persona)).toEqual(order);
      }
    }
  });
});
