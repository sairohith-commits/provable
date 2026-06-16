import type {
  AgentKey,
  AutonomyMode,
  ExternalRef,
  Outcome,
  Source,
  TaskKey,
  Transition,
  Verdict,
} from '@provable/contracts';
import type { OrgId } from '@provable/contracts';
import {
  DEFAULT_GOVERNANCE_POLICY,
  computeReadiness,
  stepLifecycle,
} from '@provable/core';
import type {
  DriftSignal,
  GuardrailTrip,
  LifecycleSignals,
  ManualDecision,
  ReadinessResult,
  TaskScope,
} from '@provable/core';
import {
  agentRepo,
  decisionRepo,
  makeRecomputePorts,
  taskRepo,
  verdictEventRepo,
  withTenant,
} from '@provable/persistence';
import type { TrackBody } from './schemas.js';

export interface RecomputeResult {
  readonly score: ReadinessResult;
  readonly effectiveMode: AutonomyMode;
  readonly transitions: readonly Transition[];
}
export interface RecomputeNotFound {
  readonly notFound: true;
}

type ZodVerdict = { kind: string; magnitude?: number | undefined };

function toVerdict(v: ZodVerdict): Verdict {
  if (v.kind === 'OVERRIDDEN') {
    return v.magnitude === undefined ? { kind: 'OVERRIDDEN' } : { kind: 'OVERRIDDEN', magnitude: v.magnitude };
  }
  return { kind: v.kind as Verdict['kind'] };
}

function toCost(
  c: { tokens?: number | undefined; usd?: number | undefined; latencyMs?: number | undefined } | undefined,
): { tokens?: number; usd?: number; latencyMs?: number } | undefined {
  if (c === undefined) return undefined;
  return {
    ...(c.tokens !== undefined ? { tokens: c.tokens } : {}),
    ...(c.usd !== undefined ? { usd: c.usd } : {}),
    ...(c.latencyMs !== undefined ? { latencyMs: c.latencyMs } : {}),
  };
}

function toSignals(s: TrackBody['signals'], asOf: string): LifecycleSignals | undefined {
  if (s === undefined) return undefined;
  let out: LifecycleSignals = {};
  if (s.drift !== undefined) {
    const drift: DriftSignal = {
      detectedAt: s.drift.detectedAt ?? asOf,
      reason: s.drift.reason,
      ...(s.drift.magnitude !== undefined ? { magnitude: s.drift.magnitude } : {}),
    };
    out = { ...out, drift };
  }
  if (s.guardrail !== undefined) {
    const guardrail: GuardrailTrip = {
      guardrailId: s.guardrail.guardrailId,
      trippedAt: s.guardrail.trippedAt ?? asOf,
      reason: s.guardrail.reason,
    };
    out = { ...out, guardrail };
  }
  if (s.manual !== undefined) {
    const manual: ManualDecision = {
      kind: s.manual.kind,
      approver: s.manual.approver,
      at: s.manual.at ?? asOf,
      ...(s.manual.reason !== undefined ? { reason: s.manual.reason } : {}),
    };
    out = { ...out, manual };
  }
  return out;
}

/**
 * The atomic recompute loop — ONE withTenant interactive transaction. Either every
 * step commits, or the whole thing rolls back (no orphan decision without its score).
 *
 * `opts.failAfterPersist` is a TEST-ONLY hook that throws after the event is persisted
 * but before score/lifecycle, to prove atomicity. The HTTP handler never sets it.
 */
export function recompute(
  orgId: OrgId,
  body: TrackBody,
  opts?: { failAfterPersist?: boolean },
): Promise<RecomputeResult | RecomputeNotFound> {
  return withTenant(orgId, async (tx) => {
    const ports = makeRecomputePorts(tx);
    const asOf = body.at ?? new Date().toISOString();
    const signals = toSignals(body.signals, asOf);

    let scope: TaskScope;
    let novel: boolean;

    if (body.type === 'decision') {
      scope = { orgId, agentKey: body.agentKey as AgentKey, taskKey: body.taskKey as TaskKey };
      await agentRepo.ensure(tx, orgId, scope.agentKey);
      await taskRepo.ensure(tx, orgId, scope.agentKey, scope.taskKey);
      const cost = toCost(body.cost);
      const created = await decisionRepo.createIfAbsent(tx, {
        orgId,
        agentKey: scope.agentKey,
        taskKey: scope.taskKey,
        at: asOf,
        action: body.action,
        verdict: body.verdict ? toVerdict(body.verdict) : { kind: 'PENDING' },
        source: body.source as Source,
        ...(body.confidence !== undefined ? { confidence: body.confidence } : {}),
        ...(cost !== undefined ? { cost } : {}),
        ...(body.outcome !== undefined ? { outcome: body.outcome as Outcome } : {}),
        ...(body.externalRef !== undefined ? { externalRef: body.externalRef as ExternalRef } : {}),
        ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
      });
      novel = created.created;
    } else {
      const existing = await decisionRepo.findByExternalRef(tx, orgId, body.externalRef as ExternalRef);
      if (existing === null) return { notFound: true };
      scope = { orgId, agentKey: existing.agentKey, taskKey: existing.taskKey };
      const applied = await verdictEventRepo.apply(tx, {
        orgId,
        source: body.source as Source,
        externalRef: body.externalRef as ExternalRef,
        at: asOf,
        ...(body.verdict ? { verdict: toVerdict(body.verdict) } : {}),
        ...(body.outcome !== undefined ? { outcome: body.outcome as Outcome } : {}),
      });
      novel = applied.appended;
    }

    // TEST-ONLY atomicity hook.
    if (opts?.failAfterPersist === true) {
      throw new Error('forced failure after persist (atomicity proof)');
    }

    const decisions = await ports.decisions.listForScope(scope);
    const readiness = computeReadiness(decisions, asOf);

    // Idempotent replay: no new data → no new score row, no lifecycle advance.
    if (!novel) {
      const state = await ports.lifecycle.read(scope);
      return { score: readiness, effectiveMode: state.effectiveMode, transitions: [] };
    }

    await ports.scores.write(scope, readiness, asOf);
    const state = await ports.lifecycle.read(scope);
    const stepInput = { ids: scope, state, readiness, policy: DEFAULT_GOVERNANCE_POLICY, asOf };
    const step = stepLifecycle(signals === undefined ? stepInput : { ...stepInput, signals });
    for (const t of step.transitions) await ports.transitions.append(t);
    await ports.lifecycle.write(scope, step.state);

    return { score: readiness, effectiveMode: step.effectiveMode, transitions: [...step.transitions] };
  });
}
