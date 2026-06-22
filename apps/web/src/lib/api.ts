import 'server-only';

import type { Role } from '@provable/contracts';
import { apiUrl, internalToken } from './env';
import type {
  AgentRow,
  CostView,
  FleetOverview,
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

/** Phase U1/U2: the fleet governance read-model — one derived status per task + reconciled KPIs. */
export async function getFleet(orgId: string, subject: string): Promise<FleetOverview> {
  const res = await fetch(`${apiUrl}/overview/fleet`, { headers: readHeaders(orgId, subject), cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /overview/fleet failed: ${res.status}`);
  return (await res.json()) as FleetOverview;
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

/** Free-set an agent×task's mode (MANUAL_OVERRIDE). The signed-in human is forwarded as both
 *  subject (role lookup) and approver (the recorded actor). API enforces free_set_mode. */
export async function setMode(
  orgId: string,
  subject: string,
  agentKey: string,
  taskKey: string,
  mode: string,
  reason: string,
  approver?: string,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const url = `${apiUrl}/agents/${encodeURIComponent(agentKey)}/tasks/${encodeURIComponent(taskKey)}/mode`;
  const res = await fetch(url, {
    method: 'POST',
    headers: readHeaders(orgId, subject, approver),
    body: JSON.stringify({ mode, reason }),
    cache: 'no-store',
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
}

// ── Phase C1: admin agent management (manage_agents / activate_deactivate) ─────
export type IdentityDisplayStatus = 'DISCOVERED' | 'ACTIVE' | 'IDLE' | 'DEACTIVATED' | 'RETIRED';
export interface AdminAgentRow {
  agentKey: string;
  displayName: string | null;
  identityState: string;
  displayStatus: IdentityDisplayStatus;
  lastSeen: string | null;
}

export async function listAdminAgents(orgId: string, subject: string): Promise<AdminAgentRow[]> {
  const res = await fetch(`${apiUrl}/admin/agents`, { headers: readHeaders(orgId, subject), cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /admin/agents failed: ${res.status}`);
  return ((await res.json()) as { agents: AdminAgentRow[] }).agents;
}

export async function provisionAgent(
  orgId: string,
  subject: string,
  agentKey: string,
  displayName?: string,
): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(`${apiUrl}/admin/agents`, {
    method: 'POST',
    headers: readHeaders(orgId, subject),
    body: JSON.stringify({ agentKey, ...(displayName ? { displayName } : {}) }),
    cache: 'no-store',
  });
  return { ok: res.ok, status: res.status };
}

export async function renameAgent(
  orgId: string,
  subject: string,
  agentKey: string,
  displayName: string,
): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(`${apiUrl}/admin/agents/${encodeURIComponent(agentKey)}`, {
    method: 'PATCH',
    headers: readHeaders(orgId, subject),
    body: JSON.stringify({ displayName }),
    cache: 'no-store',
  });
  return { ok: res.ok, status: res.status };
}

/** action ∈ deactivate | reactivate | retire. */
export async function agentIdentityAction(
  orgId: string,
  subject: string,
  agentKey: string,
  action: 'deactivate' | 'reactivate' | 'retire',
): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(`${apiUrl}/admin/agents/${encodeURIComponent(agentKey)}/${action}`, {
    method: 'POST',
    headers: readHeaders(orgId, subject),
    cache: 'no-store',
  });
  return { ok: res.ok, status: res.status };
}

// ── Phase C1: org key management (manage_keys) ────────────────────────────────
export interface AdminKeyRow {
  prefix: string;
  label: string | null;
  kind: 'SDK' | 'GATEWAY'; // distinct from lifecycle state — the API returns this
  agentKey?: string | null; // gateway keys are bound to an agent×task
  taskKey?: string | null;
  createdAt: string;
}

export async function listKeys(orgId: string, subject: string): Promise<AdminKeyRow[]> {
  const res = await fetch(`${apiUrl}/admin/keys`, { headers: readHeaders(orgId, subject), cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /admin/keys failed: ${res.status}`);
  return ((await res.json()) as { keys: AdminKeyRow[] }).keys;
}

export async function mintKey(
  orgId: string,
  subject: string,
  label?: string,
): Promise<RotateResult> {
  const res = await fetch(`${apiUrl}/admin/keys`, {
    method: 'POST',
    headers: readHeaders(orgId, subject),
    body: JSON.stringify(label ? { label } : {}),
    cache: 'no-store',
  });
  if (!res.ok) return { ok: false, status: res.status };
  const body = (await res.json()) as { key: string; prefix: string };
  return { ok: true, status: res.status, key: body.key, prefix: body.prefix };
}

export interface GatewayKeyResult extends RotateResult {
  agentKey?: string;
  taskKey?: string;
}

/** Mint a per-agent Tier-1 gateway key (Phase O2). manage_keys enforced API-side. */
export async function mintGatewayKey(
  orgId: string,
  subject: string,
  agentKey: string,
  taskKey: string,
): Promise<GatewayKeyResult> {
  const res = await fetch(`${apiUrl}/admin/keys/gateway`, {
    method: 'POST',
    headers: readHeaders(orgId, subject),
    body: JSON.stringify({ agentKey, taskKey }),
    cache: 'no-store',
  });
  if (!res.ok) return { ok: false, status: res.status };
  const body = (await res.json()) as { key: string; prefix: string; agentKey: string; taskKey: string };
  return { ok: true, status: res.status, key: body.key, prefix: body.prefix, agentKey: body.agentKey, taskKey: body.taskKey };
}

export async function revokeKey(
  orgId: string,
  subject: string,
  prefix: string,
): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(`${apiUrl}/admin/keys/${encodeURIComponent(prefix)}`, {
    method: 'DELETE',
    headers: readHeaders(orgId, subject),
    cache: 'no-store',
  });
  return { ok: res.ok, status: res.status };
}

// ── Phase W4: platform guardrail rules (configure_guardrails, enforced API-side). The signed-in
//    human's org + subject reach the internal endpoints; the org is the verified caller's. ──────
export interface GuardrailRuleRow {
  id: string;
  enabled: boolean;
  agentKey: string | null;
  taskKey: string | null;
  verdict: string | null;
  outcome: string | null;
  guardrailId: string;
  reasonTemplate: string;
  createdAt: string;
}

export async function listGuardrailRules(orgId: string, subject: string): Promise<GuardrailRuleRow[]> {
  const res = await fetch(`${apiUrl}/admin/guardrail-rules`, {
    headers: readHeaders(orgId, subject),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`GET /admin/guardrail-rules failed: ${res.status}`);
  return ((await res.json()) as { rules: GuardrailRuleRow[] }).rules;
}

export async function createGuardrailRule(
  orgId: string,
  subject: string,
  body: {
    guardrailId: string;
    reasonTemplate: string;
    agentKey?: string;
    taskKey?: string;
    verdict?: string;
    outcome?: string;
  },
): Promise<{ ok: boolean; status: number; rule?: GuardrailRuleRow }> {
  const res = await fetch(`${apiUrl}/admin/guardrail-rules`, {
    method: 'POST',
    headers: readHeaders(orgId, subject),
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, status: res.status, rule: ((await res.json()) as { rule: GuardrailRuleRow }).rule };
}

export async function setGuardrailRuleEnabled(
  orgId: string,
  subject: string,
  id: string,
  enabled: boolean,
): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(`${apiUrl}/admin/guardrail-rules/${encodeURIComponent(id)}/enabled`, {
    method: 'POST',
    headers: readHeaders(orgId, subject),
    body: JSON.stringify({ enabled }),
    cache: 'no-store',
  });
  return { ok: res.ok, status: res.status };
}

// ── Tier-2 connectors (Phase O3b) — internal-authed dashboard path. The web never holds the
//    org's machine key; the API accepts the internal token (role-gated) for these too. ─────────
export interface ConnectorRow {
  id: string;
  name: string;
  enabled: boolean;
  mapping: unknown;
  sourceUrl: string | null;
  sourceAuthHeaderName: string | null;
  hasCredential: boolean; // the credential VALUE is never returned — only this flag
  createdAt: string;
}

export async function listConnectors(orgId: string, subject: string): Promise<ConnectorRow[]> {
  const res = await fetch(`${apiUrl}/connectors`, { headers: readHeaders(orgId, subject), cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /connectors failed: ${res.status}`);
  return ((await res.json()) as { connectors: ConnectorRow[] }).connectors;
}

export async function createConnector(
  orgId: string,
  subject: string,
  body: { name: string; mapping: unknown; source?: { url?: string; authHeaderName?: string; authHeaderValue?: string } },
): Promise<{ ok: boolean; status: number; connector?: ConnectorRow }> {
  const res = await fetch(`${apiUrl}/connectors`, {
    method: 'POST',
    headers: readHeaders(orgId, subject),
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, status: res.status, connector: ((await res.json()) as { connector: ConnectorRow }).connector };
}

export async function dryRunConnector(
  orgId: string,
  subject: string,
  mapping: unknown,
  sample: unknown,
): Promise<{ ok: boolean; event?: unknown; governed?: boolean; error?: string }> {
  const res = await fetch(`${apiUrl}/connectors/dry-run`, {
    method: 'POST',
    headers: readHeaders(orgId, subject),
    body: JSON.stringify({ mapping, sample }),
    cache: 'no-store',
  });
  if (!res.ok) return { ok: false, error: `dry-run failed: ${res.status}` };
  return (await res.json()) as { ok: boolean; event?: unknown; governed?: boolean; error?: string };
}

export async function pullConnector(
  orgId: string,
  subject: string,
  id: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${apiUrl}/connectors/${encodeURIComponent(id)}/pull`, {
    method: 'POST',
    headers: readHeaders(orgId, subject),
    body: '{}',
    cache: 'no-store',
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
