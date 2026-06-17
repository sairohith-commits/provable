import 'server-only';

import { apiUrl, internalToken } from './env';
import type {
  AgentRow,
  CostView,
  RegistryAgentRow,
  SafetyView,
  SummaryView,
  Transition,
  VisibilityRow,
} from './types';

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

export async function getRegistry(orgId: string): Promise<RegistryAgentRow[]> {
  const res = await fetch(`${apiUrl}/registry`, { headers: readHeaders(orgId), cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /registry failed: ${res.status}`);
  return ((await res.json()) as { agents: RegistryAgentRow[] }).agents;
}

export async function getVisibility(orgId: string): Promise<VisibilityRow[]> {
  const res = await fetch(`${apiUrl}/visibility`, { headers: readHeaders(orgId), cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /visibility failed: ${res.status}`);
  return ((await res.json()) as { tasks: VisibilityRow[] }).tasks;
}

export async function getCost(orgId: string): Promise<CostView> {
  const res = await fetch(`${apiUrl}/cost`, { headers: readHeaders(orgId), cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /cost failed: ${res.status}`);
  return (await res.json()) as CostView;
}

export async function getGuardrails(orgId: string): Promise<SafetyView> {
  const res = await fetch(`${apiUrl}/guardrails`, { headers: readHeaders(orgId), cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /guardrails failed: ${res.status}`);
  return (await res.json()) as SafetyView;
}

export async function getSummary(orgId: string): Promise<SummaryView> {
  const res = await fetch(`${apiUrl}/summary`, { headers: readHeaders(orgId), cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /summary failed: ${res.status}`);
  return (await res.json()) as SummaryView;
}

/** The public API base URL — surfaced to the Connect quickstart (no secret). */
export function publicApiUrl(): string {
  return apiUrl;
}

export interface RotateResult {
  ok: boolean;
  status: number;
  key?: string;
  prefix?: string;
}

/** Clerk-authed key rotate (server-side; the internal token never reaches the browser). */
export async function rotateKey(orgId: string, approver: string): Promise<RotateResult> {
  const res = await fetch(`${apiUrl}/org/api-key/rotate`, {
    method: 'POST',
    headers: readHeaders(orgId, approver),
    cache: 'no-store',
  });
  if (!res.ok) return { ok: false, status: res.status };
  const body = (await res.json()) as { key: string; prefix: string };
  return { ok: true, status: res.status, key: body.key, prefix: body.prefix };
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
