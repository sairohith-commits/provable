import 'server-only';

import { clerkClient } from '@clerk/nextjs/server';
import {
  getAgents,
  getCost,
  getFleet,
  getGuardrails,
  getRegistry,
  getSummary,
  getTransitions,
  getVisibility,
} from './api';
import { displaySubject } from './format';
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

// Resolve BOTH the approver (approved a promotion) AND the actor (authored a MANUAL_OVERRIDE),
// preserving the distinction — auto-demotions carry neither. A raw user_XXX is never surfaced:
// resolved name/email if known, else a non-raw short tail (displaySubject).
function withDisplays(t: Transition, names: Map<string, string>): TransitionView {
  return {
    ...t,
    ...(t.approver !== undefined ? { approverDisplay: displaySubject(t.approver, names) } : {}),
    ...(t.actor !== undefined ? { actorDisplay: displaySubject(t.actor, names) } : {}),
  };
}

/** Load every pillar for an org in one shot, resolving approver ids to human names.
 *  `subject` is the caller's provider subject — forwarded so the API can role-gate the reads. */
export async function loadOverview(orgId: string, subject: string): Promise<OverviewData> {
  const [agents, transitions, registry, visibility, cost, guardrails, summary, fleet] = await Promise.all([
    getAgents(orgId, subject),
    getTransitions(orgId, subject),
    getRegistry(orgId, subject),
    getVisibility(orgId, subject),
    getCost(orgId, subject),
    getGuardrails(orgId, subject),
    getSummary(orgId, subject),
    getFleet(orgId, subject),
  ]);

  // Resolve both approver AND actor ids (preserve the distinction).
  const subjectIds = [...transitions, ...guardrails.events]
    .flatMap((t) => [t.approver, t.actor])
    .filter((a): a is string => typeof a === 'string');
  const names = await resolveApproverNames(subjectIds);

  return {
    agents,
    transitions: transitions.map((t) => withDisplays(t, names)),
    registry,
    visibility,
    cost,
    guardrails: {
      ...guardrails,
      events: guardrails.events.map((e) => withDisplays(e, names)),
    },
    summary,
    fleet,
  };
}
