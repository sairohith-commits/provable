import type { AgentIdentityState } from '@provable/contracts';

/**
 * Agent identity state machine (PROVABLE_CORE_ARCHITECTURE.md §2A):
 * DISCOVERED → ACTIVE → DORMANT → RETIRED.
 *
 * PURE and event-driven. Core does NOT decide what counts as activity or how long
 * dormancy takes (that would require a clock or an invented window) — the caller
 * passes the distilled event, keeping this referentially transparent.
 */
export type IdentityEvent = 'ACTIVITY' | 'INACTIVITY' | 'RETIRE';

export function transitionIdentity(
  current: AgentIdentityState,
  event: IdentityEvent,
): AgentIdentityState {
  if (current === 'RETIRED') return 'RETIRED'; // terminal
  switch (event) {
    case 'RETIRE':
      return 'RETIRED';
    case 'ACTIVITY':
      // First signal activates; dormant agents reactivate; active stays active.
      return current === 'DISCOVERED' || current === 'DORMANT' ? 'ACTIVE' : current;
    case 'INACTIVITY':
      return current === 'ACTIVE' ? 'DORMANT' : current;
  }
}
