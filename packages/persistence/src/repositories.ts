import { Prisma } from '@prisma/client';
import type {
  AgentIdentityState,
  AgentKey,
  AutonomyMode,
  Decision,
  ExternalRef,
  Outcome,
  Source,
  Transition,
  Verdict,
  VerdictKind,
} from '@provable/contracts';
import type { OrgId, TaskKey } from '@provable/contracts';
import { mapDecision, mapScore, mapTransition, mapVerdictEvent } from './mappers.js';
import type { ScoreRecord } from './mappers.js';
import type { TenantClient } from './tenant.js';

function asJson(value: unknown): Prisma.InputJsonValue {
  return (value === undefined ? Prisma.JsonNull : value) as Prisma.InputJsonValue;
}

// ── Org / Agent / Task: idempotent scope upserts ─────────────────────────────
export const orgRepo = {
  async ensure(tx: TenantClient, orgId: OrgId, name?: string): Promise<void> {
    await tx.org.upsert({
      where: { id: orgId },
      create: { id: orgId, ...(name !== undefined ? { name } : {}) },
      update: {},
    });
  },

  /** Set the org's machine-key handle (prefix) + sha256 hash. Secret is never stored. */
  async setApiKey(
    tx: TenantClient,
    orgId: OrgId,
    apiKeyPrefix: string,
    apiKeyHash: string,
  ): Promise<void> {
    await tx.org.upsert({
      where: { id: orgId },
      create: { id: orgId, apiKeyPrefix, apiKeyHash },
      update: { apiKeyPrefix, apiKeyHash },
    });
  },

  /** Link a Clerk Organization to this Provable org (Phase 7 dashboard auth). */
  async linkClerkOrg(tx: TenantClient, orgId: OrgId, clerkOrgId: string): Promise<void> {
    await tx.org.update({ where: { id: orgId }, data: { clerkOrgId } });
  },
};

export interface AgentRecord {
  agentKey: AgentKey;
  displayName: string | null;
  identityState: AgentIdentityState;
  createdAt: string;
}

export const agentRepo = {
  async ensure(
    tx: TenantClient,
    orgId: OrgId,
    agentKey: AgentKey,
    identityState?: AgentIdentityState,
  ): Promise<void> {
    await tx.agent.upsert({
      where: { orgId_agentKey: { orgId, agentKey } },
      create: { orgId, agentKey, ...(identityState !== undefined ? { identityState } : {}) },
      update: {},
    });
  },

  async find(tx: TenantClient, orgId: OrgId, agentKey: AgentKey): Promise<AgentRecord | null> {
    const a = await tx.agent.findUnique({ where: { orgId_agentKey: { orgId, agentKey } } });
    return a === null
      ? null
      : {
          agentKey: a.agentKey as AgentKey,
          displayName: a.displayName,
          identityState: a.identityState,
          createdAt: a.createdAt.toISOString(),
        };
  },

  async list(tx: TenantClient, orgId: OrgId): Promise<AgentRecord[]> {
    const rows = await tx.agent.findMany({ where: { orgId }, orderBy: { agentKey: 'asc' } });
    return rows.map((a) => ({
      agentKey: a.agentKey as AgentKey,
      displayName: a.displayName,
      identityState: a.identityState,
      createdAt: a.createdAt.toISOString(),
    }));
  },

  /** Rename = set the human-friendly displayName (agentKey is immutable). */
  async setDisplayName(
    tx: TenantClient,
    orgId: OrgId,
    agentKey: AgentKey,
    displayName: string,
  ): Promise<void> {
    await tx.agent.update({ where: { orgId_agentKey: { orgId, agentKey } }, data: { displayName } });
  },

  /** Write the authoritative identity state (admin transitions go through core's machine). */
  async setIdentityState(
    tx: TenantClient,
    orgId: OrgId,
    agentKey: AgentKey,
    identityState: AgentIdentityState,
  ): Promise<void> {
    await tx.agent.update({ where: { orgId_agentKey: { orgId, agentKey } }, data: { identityState } });
  },

  /**
   * First-contact activation: DISCOVERED → ACTIVE on real activity. Deliberately advances ONLY
   * from DISCOVERED — an admin-DORMANT or RETIRED agent keeps recording decisions but its state
   * does NOT auto-revive (telemetry is never dropped; the admin decision is authoritative).
   */
  async markActiveOnFirstContact(tx: TenantClient, orgId: OrgId, agentKey: AgentKey): Promise<void> {
    await tx.agent.updateMany({
      where: { orgId, agentKey, identityState: 'DISCOVERED' },
      data: { identityState: 'ACTIVE' },
    });
  },
};

export interface ApiKeyRow {
  prefix: string;
  label: string | null;
  kind: 'SDK' | 'GATEWAY';
  agentKey: string | null;
  taskKey: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export const apiKeyRepo = {
  /** Mint an org-scoped SDK key row (the plaintext is shown once by the caller; never stored). */
  async mint(
    tx: TenantClient,
    orgId: OrgId,
    prefix: string,
    hash: string,
    label?: string,
  ): Promise<void> {
    await tx.apiKey.create({
      data: { orgId, prefix, hash, kind: 'SDK', ...(label !== undefined ? { label } : {}) },
    });
  },

  /**
   * Mint a per-agent GATEWAY key (Phase O2) bound to agentKey + a default taskKey. Distinct kind
   * from the SDK machine key — resolved only by the gateway proxy, never honored on /track etc.
   */
  async mintGateway(
    tx: TenantClient,
    orgId: OrgId,
    agentKey: string,
    taskKey: string,
    prefix: string,
    hash: string,
    label?: string,
  ): Promise<void> {
    await tx.apiKey.create({
      data: { orgId, prefix, hash, kind: 'GATEWAY', agentKey, taskKey, ...(label !== undefined ? { label } : {}) },
    });
  },

  /** Active (non-revoked) keys for the org, newest first. */
  async listActive(tx: TenantClient, orgId: OrgId): Promise<ApiKeyRow[]> {
    const rows = await tx.apiKey.findMany({
      where: { orgId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((k) => ({
      prefix: k.prefix,
      label: k.label,
      kind: k.kind,
      agentKey: k.agentKey,
      taskKey: k.taskKey,
      createdAt: k.createdAt.toISOString(),
      revokedAt: k.revokedAt === null ? null : k.revokedAt.toISOString(),
    }));
  },

  /** Soft-revoke a key by prefix (immediate: auth_resolve_org ignores revoked keys). Returns
   *  the number of active keys actually revoked (0 if unknown/already revoked). */
  async revoke(tx: TenantClient, orgId: OrgId, prefix: string): Promise<number> {
    const res = await tx.apiKey.updateMany({
      where: { orgId, prefix, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return res.count;
  },

  /** Revoke every active key EXCEPT the given prefix — the single-active-key rotate (7c). */
  async revokeOthers(tx: TenantClient, orgId: OrgId, keepPrefix: string): Promise<number> {
    const res = await tx.apiKey.updateMany({
      where: { orgId, revokedAt: null, prefix: { not: keepPrefix } },
      data: { revokedAt: new Date() },
    });
    return res.count;
  },

  /** Most-recent active key prefix — the Connect view's display handle. */
  async latestActivePrefix(tx: TenantClient, orgId: OrgId): Promise<string | null> {
    const row = await tx.apiKey.findFirst({
      where: { orgId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return row?.prefix ?? null;
  },
};

// ── Tier-2 connector config (Phase O3a) ──────────────────────────────────────────
/** PUBLIC read shape — deliberately OMITS the encrypted credential so it can never be serialized
 *  into a response. `hasCredential` exposes only whether one is set. */
export interface ConnectorConfigRow {
  id: string;
  name: string;
  enabled: boolean;
  mapping: unknown; // DeclarativeMapping JSON (validated by @provable/adapters on load)
  sourceUrl: string | null;
  sourceAuthHeaderName: string | null;
  hasCredential: boolean;
  createdAt: string;
}

export interface ConnectorCreateInput {
  name: string;
  mapping: unknown;
  sourceUrl?: string;
  sourceAuthHeaderName?: string;
  sourceAuthHeaderValueEnc?: string; // already-encrypted ciphertext (the API encrypts; repo stores)
}

/** The pull source + its (still-encrypted) credential — internal use only (the pull handler
 *  decrypts at fetch time). Never returned by a public route. */
export interface ConnectorSourceSecret {
  enabled: boolean;
  mapping: unknown;
  sourceUrl: string | null;
  sourceAuthHeaderName: string | null;
  sourceAuthHeaderValueEnc: string | null;
}

function toConnectorRow(k: {
  id: string;
  name: string;
  enabled: boolean;
  mapping: Prisma.JsonValue;
  sourceUrl: string | null;
  sourceAuthHeaderName: string | null;
  sourceAuthHeaderValueEnc: string | null;
  createdAt: Date;
}): ConnectorConfigRow {
  return {
    id: k.id,
    name: k.name,
    enabled: k.enabled,
    mapping: k.mapping,
    sourceUrl: k.sourceUrl,
    sourceAuthHeaderName: k.sourceAuthHeaderName,
    hasCredential: k.sourceAuthHeaderValueEnc !== null && k.sourceAuthHeaderValueEnc.length > 0,
    createdAt: k.createdAt.toISOString(),
  };
}

export const connectorConfigRepo = {
  /** Create a connector config (the credential ciphertext is supplied pre-encrypted by the API). */
  async create(tx: TenantClient, orgId: OrgId, input: ConnectorCreateInput): Promise<ConnectorConfigRow> {
    const row = await tx.connectorConfig.create({
      data: {
        orgId,
        name: input.name,
        mapping: input.mapping as Prisma.InputJsonValue,
        ...(input.sourceUrl !== undefined ? { sourceUrl: input.sourceUrl } : {}),
        ...(input.sourceAuthHeaderName !== undefined ? { sourceAuthHeaderName: input.sourceAuthHeaderName } : {}),
        ...(input.sourceAuthHeaderValueEnc !== undefined ? { sourceAuthHeaderValueEnc: input.sourceAuthHeaderValueEnc } : {}),
      },
    });
    return toConnectorRow(row);
  },

  /** Public read (no credential). RLS already scopes to the org; orgId is belt-and-suspenders. */
  async getById(tx: TenantClient, orgId: OrgId, id: string): Promise<ConnectorConfigRow | null> {
    const row = await tx.connectorConfig.findFirst({ where: { id, orgId } });
    return row === null ? null : toConnectorRow(row);
  },

  /** All connectors for the org, newest first (no credentials). */
  async list(tx: TenantClient, orgId: OrgId): Promise<ConnectorConfigRow[]> {
    const rows = await tx.connectorConfig.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' } });
    return rows.map(toConnectorRow);
  },

  /** INTERNAL: the pull source + encrypted credential (decrypted by the pull handler). */
  async getSourceSecret(tx: TenantClient, orgId: OrgId, id: string): Promise<ConnectorSourceSecret | null> {
    const row = await tx.connectorConfig.findFirst({ where: { id, orgId } });
    if (row === null) return null;
    return {
      enabled: row.enabled,
      mapping: row.mapping,
      sourceUrl: row.sourceUrl,
      sourceAuthHeaderName: row.sourceAuthHeaderName,
      sourceAuthHeaderValueEnc: row.sourceAuthHeaderValueEnc,
    };
  },
};

// ── Phase W4 — platform guardrail rules (per-org; RLS-isolated) ────────────────────────
export interface GuardrailRuleRow {
  id: string;
  enabled: boolean;
  agentKey: string | null;
  taskKey: string | null;
  verdict: VerdictKind | null;
  outcome: Outcome | null;
  guardrailId: string;
  reasonTemplate: string;
  createdAt: string;
}

export interface GuardrailRuleCreateInput {
  agentKey?: string;
  taskKey?: string;
  verdict?: VerdictKind;
  outcome?: Outcome;
  guardrailId: string;
  reasonTemplate: string;
}

function toGuardrailRuleRow(r: {
  id: string;
  enabled: boolean;
  agentKey: string | null;
  taskKey: string | null;
  verdict: VerdictKind | null;
  outcome: Outcome | null;
  guardrailId: string;
  reasonTemplate: string;
  createdAt: Date;
}): GuardrailRuleRow {
  return {
    id: r.id,
    enabled: r.enabled,
    agentKey: r.agentKey,
    taskKey: r.taskKey,
    verdict: r.verdict,
    outcome: r.outcome,
    guardrailId: r.guardrailId,
    reasonTemplate: r.reasonTemplate,
    createdAt: r.createdAt.toISOString(),
  };
}

export const guardrailRuleRepo = {
  /** Create a rule. orgId comes from the verified caller — never the payload. */
  async create(tx: TenantClient, orgId: OrgId, input: GuardrailRuleCreateInput): Promise<GuardrailRuleRow> {
    const row = await tx.guardrailRule.create({
      data: {
        orgId,
        guardrailId: input.guardrailId,
        reasonTemplate: input.reasonTemplate,
        ...(input.agentKey !== undefined ? { agentKey: input.agentKey } : {}),
        ...(input.taskKey !== undefined ? { taskKey: input.taskKey } : {}),
        ...(input.verdict !== undefined ? { verdict: input.verdict } : {}),
        ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
      },
    });
    return toGuardrailRuleRow(row);
  },

  /** All rules for the org, newest first. */
  async list(tx: TenantClient, orgId: OrgId): Promise<GuardrailRuleRow[]> {
    const rows = await tx.guardrailRule.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' } });
    return rows.map(toGuardrailRuleRow);
  },

  /** Enabled rules only — the set evaluated at ingestion. */
  async listEnabled(tx: TenantClient, orgId: OrgId): Promise<GuardrailRuleRow[]> {
    const rows = await tx.guardrailRule.findMany({
      where: { orgId, enabled: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toGuardrailRuleRow);
  },

  /** Enable/disable a rule (no delete — disable via enabled). Returns null if not in the org. */
  async setEnabled(
    tx: TenantClient,
    orgId: OrgId,
    id: string,
    enabled: boolean,
  ): Promise<GuardrailRuleRow | null> {
    const existing = await tx.guardrailRule.findFirst({ where: { id, orgId } });
    if (existing === null) return null;
    const row = await tx.guardrailRule.update({ where: { id }, data: { enabled } });
    return toGuardrailRuleRow(row);
  },
};

export const taskRepo = {
  async ensure(
    tx: TenantClient,
    orgId: OrgId,
    agentKey: AgentKey,
    taskKey: TaskKey,
    effectiveMode?: AutonomyMode,
  ): Promise<void> {
    await tx.task.upsert({
      where: { orgId_agentKey_taskKey: { orgId, agentKey, taskKey } },
      create: { orgId, agentKey, taskKey, ...(effectiveMode !== undefined ? { effectiveMode } : {}) },
      update: {},
    });
  },

  async findEffectiveMode(
    tx: TenantClient,
    orgId: OrgId,
    agentKey: AgentKey,
    taskKey: TaskKey,
  ): Promise<AutonomyMode | null> {
    const row = await tx.task.findUnique({
      where: { orgId_agentKey_taskKey: { orgId, agentKey, taskKey } },
    });
    return row === null ? null : row.effectiveMode;
  },

  /** All agent×task rows for the current tenant (RLS-scoped) — for the dashboard registry. */
  async list(
    tx: TenantClient,
  ): Promise<{ agentKey: AgentKey; taskKey: TaskKey; effectiveMode: AutonomyMode }[]> {
    const rows = await tx.task.findMany({ orderBy: [{ agentKey: 'asc' }, { taskKey: 'asc' }] });
    return rows.map((r) => ({
      agentKey: r.agentKey as AgentKey,
      taskKey: r.taskKey as TaskKey,
      effectiveMode: r.effectiveMode,
    }));
  },
};

// ── Decision ─────────────────────────────────────────────────────────────────
export interface DecisionCreateInput {
  orgId: OrgId;
  agentKey: AgentKey;
  taskKey: TaskKey;
  at: string;
  action: unknown;
  confidence?: number;
  cost?: { tokens?: number; usd?: number; latencyMs?: number };
  verdict: Verdict;
  outcome?: Outcome;
  source: Source;
  externalRef?: ExternalRef;
  metadata?: Record<string, unknown>;
}

export const decisionRepo = {
  /** Ensures org/agent/task exist, then inserts the decision (materialized state from its verdict). */
  async create(tx: TenantClient, input: DecisionCreateInput): Promise<Decision> {
    await orgRepo.ensure(tx, input.orgId);
    await agentRepo.ensure(tx, input.orgId, input.agentKey);
    await taskRepo.ensure(tx, input.orgId, input.agentKey, input.taskKey);

    const resolved = input.verdict.kind !== 'PENDING' || input.outcome !== undefined;
    const row = await tx.decision.create({
      data: {
        orgId: input.orgId,
        agentKey: input.agentKey,
        taskKey: input.taskKey,
        at: new Date(input.at),
        action: asJson(input.action),
        confidence: input.confidence ?? null,
        costTokens: input.cost?.tokens ?? null,
        costUsd: input.cost?.usd ?? null,
        costLatencyMs: input.cost?.latencyMs ?? null,
        verdictKind: input.verdict.kind,
        overrideMagnitude:
          input.verdict.kind === 'OVERRIDDEN' ? (input.verdict.magnitude ?? null) : null,
        outcome: input.outcome ?? null,
        status: resolved ? 'RESOLVED' : 'PENDING',
        source: input.source,
        externalRef: input.externalRef ?? null,
        ...(input.metadata !== undefined ? { metadata: asJson(input.metadata) } : {}),
      },
    });
    return mapDecision(row);
  },

  async findByExternalRef(
    tx: TenantClient,
    orgId: OrgId,
    externalRef: ExternalRef,
  ): Promise<Decision | null> {
    const row = await tx.decision.findUnique({ where: { orgId_externalRef: { orgId, externalRef } } });
    return row === null ? null : mapDecision(row);
  },

  /** Idempotent ingest: if a decision with this externalRef exists, return it unchanged. */
  async createIfAbsent(
    tx: TenantClient,
    input: DecisionCreateInput,
  ): Promise<{ decision: Decision; created: boolean }> {
    if (input.externalRef !== undefined) {
      const existing = await decisionRepo.findByExternalRef(tx, input.orgId, input.externalRef);
      if (existing !== null) return { decision: existing, created: false };
    }
    return { decision: await decisionRepo.create(tx, input), created: true };
  },

  async list(tx: TenantClient): Promise<Decision[]> {
    const rows = await tx.decision.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(mapDecision);
  },
};

// ── VerdictEvent: append-only log + idempotent materialization ────────────────
export interface VerdictEventInput {
  orgId: OrgId;
  source: Source;
  externalRef: ExternalRef;
  verdict?: Verdict;
  outcome?: Outcome;
  at: string;
}

export const verdictEventRepo = {
  /**
   * Append the event (idempotent — replays dedup on (orgId, source, externalRef, at))
   * and materialize the target decision's current verdict/outcome/status.
   */
  async apply(
    tx: TenantClient,
    event: VerdictEventInput,
  ): Promise<{ decision: Decision | null; appended: boolean }> {
    const { count } = await tx.verdictEvent.createMany({
      data: [
        {
          orgId: event.orgId,
          source: event.source,
          externalRef: event.externalRef,
          at: new Date(event.at),
          ...(event.verdict !== undefined ? { verdictKind: event.verdict.kind } : {}),
          ...(event.verdict?.kind === 'OVERRIDDEN' && event.verdict.magnitude !== undefined
            ? { overrideMagnitude: event.verdict.magnitude }
            : {}),
          ...(event.outcome !== undefined ? { outcome: event.outcome } : {}),
        },
      ],
      skipDuplicates: true,
    });
    const appended = count > 0;

    const decision = await tx.decision.findUnique({
      where: { orgId_externalRef: { orgId: event.orgId, externalRef: event.externalRef } },
    });
    if (decision === null) return { decision: null, appended };

    const data: Prisma.DecisionUpdateInput = {};
    if (event.verdict !== undefined) {
      data.verdictKind = event.verdict.kind;
      data.overrideMagnitude =
        event.verdict.kind === 'OVERRIDDEN' ? (event.verdict.magnitude ?? null) : null;
    }
    if (event.outcome !== undefined) data.outcome = event.outcome;

    const newVerdictKind = event.verdict?.kind ?? decision.verdictKind;
    const newOutcome = event.outcome ?? decision.outcome;
    data.status = newVerdictKind !== 'PENDING' || newOutcome !== null ? 'RESOLVED' : 'PENDING';

    const updated = await tx.decision.update({ where: { id: decision.id }, data });
    return { decision: mapDecision(updated), appended };
  },

  async countForExternalRef(
    tx: TenantClient,
    orgId: OrgId,
    externalRef: ExternalRef,
  ): Promise<number> {
    return tx.verdictEvent.count({ where: { orgId, externalRef } });
  },

  async list(tx: TenantClient): Promise<ReturnType<typeof mapVerdictEvent>[]> {
    const rows = await tx.verdictEvent.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(mapVerdictEvent);
  },
};

// ── Transition (audit trail; recorded by core orchestration in a later phase) ──
export const transitionRepo = {
  async record(tx: TenantClient, t: Transition): Promise<Transition> {
    const row = await tx.transition.create({
      data: {
        orgId: t.orgId,
        agentKey: t.agentKey,
        taskKey: t.taskKey,
        fromMode: t.fromMode,
        toMode: t.toMode,
        direction: t.direction,
        trigger: t.trigger,
        status: t.status,
        reason: t.reason,
        at: new Date(t.at),
        ...(t.approver !== undefined ? { approver: t.approver } : {}),
        ...(t.actor !== undefined ? { actor: t.actor } : {}),
      },
    });
    return mapTransition(row);
  },

  async list(tx: TenantClient): Promise<Transition[]> {
    const rows = await tx.transition.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(mapTransition);
  },
};

// ── Score (read-back; written by the recompute ports) ─────────────────────────
export const scoreRepo = {
  async latest(
    tx: TenantClient,
    orgId: OrgId,
    agentKey: AgentKey,
    taskKey: TaskKey,
  ): Promise<ScoreRecord | null> {
    const row = await tx.score.findFirst({
      where: { orgId, agentKey, taskKey },
      orderBy: { calculatedAt: 'desc' },
    });
    return row === null ? null : mapScore(row);
  },
};
