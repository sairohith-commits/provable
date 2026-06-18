import 'server-only';

import type { Role } from '@provable/contracts';
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
//
// Phase B: every internal call also forwards `x-provable-subject` (the stable provider
// subject). The API re-derives the caller's RBAC role from membership(orgId, subject) — the
// web NEVER asserts the role for enforcement. `x-provable-role` is intentionally NOT sent as
// an authority; role is the API's own lookup.

function readHeaders(orgId: string, subject: string, approver?: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-provable-internal-token': internalToken(),
    'x-provable-org-id': orgId,
    'x-provable-subject': subject,
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

/**
 * Resolve the caller's role (and bind a pending invite on first login). Forwards the verified
 * email + verification flag so the API can bind only on a provider-verified address. Returns
 * the Role, or null when the caller has no membership (= no access).
 */
export async function fetchRole(
  orgId: string,
  subject: string,
  email: string | null,
  emailVerified: boolean,
): Promise<Role | null> {
  const res = await fetch(`${apiUrl}/me`, {
    headers: {
      'x-provable-internal-token': internalToken(),
      'x-provable-org-id': orgId,
      'x-provable-subject': subject,
      'x-provable-email': email ?? '',
      'x-provable-email-verified': emailVerified ? 'true' : 'false',
    },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return ((await res.json()) as { role: Role | null }).role;
}

export async function getAgents(orgId: string, subject: string): Promise<AgentRow[]> {
  const res = await fetch(`${apiUrl}/agents`, { headers: readHeaders(orgId, subject), cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /agents failed: ${res.status}`);
  return ((await res.json()) as { agents: AgentRow[] }).agents;
}

export async function getTransitions(orgId: string, subject: string): Promise<Transition[]> {
  const res = await fetch(`${apiUrl}/transitions`, { headers: readHeaders(orgId, subject), cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /transitions failed: ${res.status}`);
  return ((await res.json()) as { transitions: Transition[] }).transitions;
}

export async function getRegistry(orgId: string, subject: string): Promise<RegistryAgentRow[]> {
  const res = await fetch(`${apiUrl}/registry`, { headers: readHeaders(orgId, subject), cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /registry failed: ${res.status}`);
  return ((await res.json()) as { agents: RegistryAgentRow[] }).agents;
}

export async function getVisibility(orgId: string, subject: string): Promise<VisibilityRow[]> {
  const res = await fetch(`${apiUrl}/visibility`, { headers: readHeaders(orgId, subject), cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /visibility failed: ${res.status}`);
  return ((await res.json()) as { tasks: VisibilityRow[] }).tasks;
}

export async function getCost(orgId: string, subject: string): Promise<CostView> {
  const res = await fetch(`${apiUrl}/cost`, { headers: readHeaders(orgId, subject), cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /cost failed: ${res.status}`);
  return (await res.json()) as CostView;
}

export async function getGuardrails(orgId: string, subject: string): Promise<SafetyView> {
  const res = await fetch(`${apiUrl}/guardrails`, { headers: readHeaders(orgId, subject), cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /guardrails failed: ${res.status}`);
  return (await res.json()) as SafetyView;
}

export async function getSummary(orgId: string, subject: string): Promise<SummaryView> {
  const res = await fetch(`${apiUrl}/summary`, { headers: readHeaders(orgId, subject), cache: 'no-store' });
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
export async function rotateKey(orgId: string, subject: string, approver: string): Promise<RotateResult> {
  const res = await fetch(`${apiUrl}/org/api-key/rotate`, {
    method: 'POST',
    headers: readHeaders(orgId, subject, approver),
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
  subject: string,
  agentKey: string,
  taskKey: string,
  approver: string,
): Promise<ApproveResult> {
  const url = `${apiUrl}/agents/${encodeURIComponent(agentKey)}/tasks/${encodeURIComponent(taskKey)}/approve`;
  const res = await fetch(url, { method: 'POST', headers: readHeaders(orgId, subject, approver), cache: 'no-store' });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
}

// ── RBAC people management (Owner-only, enforced API-side: manage_people) ──────
export interface MemberRow {
  email: string;
  subject: string | null;
  role: Role;
  boundAt: string | null;
  createdAt: string;
}

export async function listMembers(orgId: string, subject: string): Promise<MemberRow[]> {
  const res = await fetch(`${apiUrl}/org/members`, { headers: readHeaders(orgId, subject), cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /org/members failed: ${res.status}`);
  return ((await res.json()) as { members: MemberRow[] }).members;
}

export async function inviteMember(
  orgId: string,
  subject: string,
  email: string,
  role: Role,
): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(`${apiUrl}/org/members`, {
    method: 'POST',
    headers: readHeaders(orgId, subject),
    body: JSON.stringify({ email, role }),
    cache: 'no-store',
  });
  return { ok: res.ok, status: res.status };
}

export async function setMemberRole(
  orgId: string,
  subject: string,
  email: string,
  role: Role,
): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(`${apiUrl}/org/members/${encodeURIComponent(email)}`, {
    method: 'PATCH',
    headers: readHeaders(orgId, subject),
    body: JSON.stringify({ role }),
    cache: 'no-store',
  });
  return { ok: res.ok, status: res.status };
}

export async function removeMember(
  orgId: string,
  subject: string,
  email: string,
): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(`${apiUrl}/org/members/${encodeURIComponent(email)}`, {
    method: 'DELETE',
    headers: readHeaders(orgId, subject),
    cache: 'no-store',
  });
  return { ok: res.ok, status: res.status };
}
