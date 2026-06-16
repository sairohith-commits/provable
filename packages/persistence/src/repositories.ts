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
};

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
