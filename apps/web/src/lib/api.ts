import 'server-only';

import { apiUrl, internalToken } from './env';
import type { AgentRow, Transition } from './types';

// The web is a PURE HTTP client of the read API. It holds NO DB credentials and never
// imports @provable/persistence/core/api — it speaks only the machine contract over HTTP,
// authenticated with the internal token + the Clerk-derived Provable org id.

function readHeaders(orgId: string, approver?: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-provable-internal-token': internalToken(),
    'x-provable-org-id': orgId,
    ...(approver !== undefined ? { 'x-provable-approver': approver } : {}),
  };
}

export async function resolveOrg(clerkOrgId: string): Promise<string | null> {
  const res = await fetch(`${apiUrl}/resolve-org?clerkOrgId=${encodeURIComponent(clerkOrgId)}`, {
    headers: { 'x-provable-internal-token': internalToken() },
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`resolve-org failed: ${res.status}`);
  return ((await res.json()) as { orgId: string }).orgId;
}

export async function getAgents(orgId: string): Promise<AgentRow[]> {
  const res = await fetch(`${apiUrl}/agents`, { headers: readHeaders(orgId), cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /agents failed: ${res.status}`);
  return ((await res.json()) as { agents: AgentRow[] }).agents;
}

export async function getTransitions(orgId: string): Promise<Transition[]> {
  const res = await fetch(`${apiUrl}/transitions`, { headers: readHeaders(orgId), cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /transitions failed: ${res.status}`);
  return ((await res.json()) as { transitions: Transition[] }).transitions;
}

export interface ApproveResult {
  ok: boolean;
  status: number;
  body: unknown;
}

export async function approve(
  orgId: string,
  agentKey: string,
  taskKey: string,
  approver: string,
): Promise<ApproveResult> {
  const url = `${apiUrl}/agents/${encodeURIComponent(agentKey)}/tasks/${encodeURIComponent(taskKey)}/approve`;
  const res = await fetch(url, { method: 'POST', headers: readHeaders(orgId, approver), cache: 'no-store' });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
}
