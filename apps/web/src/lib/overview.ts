import 'server-only';

import { clerkClient } from '@clerk/nextjs/server';
import {
  getAgents,
  getCost,
  getGuardrails,
  getRegistry,
  getSummary,
  getTransitions,
  getVisibility,
} from './api';
import type { OverviewData, Transition, TransitionView } from './types';

/**
 * Resolve Clerk user ids → human display names (Readiness fix #2). The audit trail must
 * read "Ada Lovelace", not "user_3FE…". Non-user_ approvers (already an email) pass through.
 * Resolution failures fall back to the raw id rather than throwing — the feed still renders.
 */
async function resolveApproverNames(ids: readonly string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const userIds = [...new Set(ids.filter((id) => id.startsWith('user_')))];
  if (userIds.length === 0) return map;
  const client = await clerkClient();
  await Promise.all(
    userIds.map(async (id) => {
      try {
        const u = await client.users.getUser(id);
        const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
        const email =
          u.primaryEmailAddress?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? null;
        map.set(id, name.length > 0 ? name : (email ?? id));
      } catch {
        // leave unresolved → falls back to the raw id
      }
    }),
  );
  return map;
}

function withApprover(t: Transition, names: Map<string, string>): TransitionView {
  if (t.approver === undefined) return t;
  const display = t.approver.startsWith('user_') ? (names.get(t.approver) ?? t.approver) : t.approver;
  return { ...t, approverDisplay: display };
}

/** Load every pillar for an org in one shot, resolving approver ids to human names. */
export async function loadOverview(orgId: string): Promise<OverviewData> {
  const [agents, transitions, registry, visibility, cost, guardrails, summary] = await Promise.all([
    getAgents(orgId),
    getTransitions(orgId),
    getRegistry(orgId),
    getVisibility(orgId),
    getCost(orgId),
    getGuardrails(orgId),
    getSummary(orgId),
  ]);

  const approverIds = [...transitions, ...guardrails.events]
    .map((t) => t.approver)
    .filter((a): a is string => typeof a === 'string');
  const names = await resolveApproverNames(approverIds);

  return {
    agents,
    transitions: transitions.map((t) => withApprover(t, names)),
    registry,
    visibility,
    cost,
    guardrails: {
      ...guardrails,
      events: guardrails.events.map((e) => withApprover(e, names)),
    },
    summary,
  };
}
