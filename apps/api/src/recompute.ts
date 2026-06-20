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
  evaluateGuardrails,
  stepLifecycle,
} from '@provable/core';
import type {
  DecisionRule,
  DriftSignal,
  EvaluableDecision,
  GuardrailTrip,
  LifecycleSignals,
  ManualDecision,
  ReadinessResult,
  TaskScope,
} from '@provable/core';
import {
  agentRepo,
  decisionRepo,
  guardrailRuleRepo,
  makeRecomputePorts,
  taskRepo,
  verdictEventRepo,
  withTenant,
} from '@provable/persistence';
import type { GuardrailRuleRow } from '@provable/persistence';
import type { TrackBody } from './schemas.js';

/**
 * The actor stamped on a PLATFORM-detected guardrail trip's Transition, so the audit can tell who
 * caught it: "policy" (Provable evaluated an org rule) vs an agent-reported trip (no actor). An
 * agent never sets this — it comes only from the ingestion-side rule evaluation below.
 */
const PLATFORM_ACTOR = 'policy';

/** Map a stored guardrail rule row → the generic, domain-agnostic rule core evaluates. */
function toDecisionRule(r: GuardrailRuleRow): DecisionRule {
  return {
    id: r.guardrailId,
    reason: r.reasonTemplate,
    ...(r.agentKey !== null ? { agentKey: r.agentKey as AgentKey } : {}),
    ...(r.taskKey !== null ? { taskKey: r.taskKey as TaskKey } : {}),
    ...(r.verdict !== null ? { verdict: r.verdict } : {}),
    ...(r.outcome !== null ? { outcome: r.outcome } : {}),
  };
}

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
    // The single decision this ingest affects, reduced to the generic fields guardrail rules read.
    let evalDecision: EvaluableDecision | null = null;

    if (body.type === 'decision') {
      scope = { orgId, agentKey: body.agentKey as AgentKey, taskKey: body.taskKey as TaskKey };
      await agentRepo.ensure(tx, orgId, scope.agentKey);
      // First-contact activation: DISCOVERED → ACTIVE. An admin-DORMANT/RETIRED agent keeps
      // recording decisions here but its state does NOT auto-revive (telemetry never dropped).
      await agentRepo.markActiveOnFirstContact(tx, orgId, scope.agentKey);
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
      evalDecision = {
        agentKey: scope.agentKey,
        taskKey: scope.taskKey,
        verdict: body.verdict ? toVerdict(body.verdict).kind : 'PENDING',
        ...(body.outcome !== undefined ? { outcome: body.outcome as Outcome } : {}),
      };
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
      if (applied.decision !== null) {
        evalDecision = {
          agentKey: applied.decision.agentKey,
          taskKey: applied.decision.taskKey,
          verdict: applied.decision.verdict.kind,
          ...(applied.decision.outcome !== undefined ? { outcome: applied.decision.outcome } : {}),
        };
      }
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

    // ── Platform-enforced guardrails (W4). Provable evaluates the org's enabled rules against
    //    THIS ingested decision and trips the guardrail ITSELF on a violation — reusing the exact
    //    trip→SUSPENDED lifecycle an agent-reported signal triggers. Back-compat: skip when the
    //    agent already reported a guardrail (its path is untouched). Idempotent: only novel
    //    ingests reach here (replays returned above). Both SDK-track and connector decisions flow
    //    through this same recompute, so both are evaluated.
    let effectiveSignals = signals;
    let platformDetected = false;
    if (evalDecision !== null && (signals === undefined || signals.guardrail === undefined)) {
      const rules = (await guardrailRuleRepo.listEnabled(tx, orgId)).map(toDecisionRule);
      const match = evaluateGuardrails(evalDecision, rules);
      if (match !== null) {
        const guardrail: GuardrailTrip = { guardrailId: match.id, trippedAt: asOf, reason: match.reason };
        effectiveSignals = { ...(signals ?? {}), guardrail };
        platformDetected = true;
      }
    }

    const step = stepLifecycle(
      effectiveSignals === undefined ? stepInput : { ...stepInput, signals: effectiveSignals },
    );
    // Stamp the platform-detected trip so Legal can tell Provable caught it, not the agent.
    const transitions = platformDetected
      ? step.transitions.map((t) =>
          t.trigger === 'GUARDRAIL' && t.actor === undefined ? { ...t, actor: PLATFORM_ACTOR } : t,
        )
      : step.transitions;
    for (const t of transitions) await ports.transitions.append(t);
    await ports.lifecycle.write(scope, step.state);

    return { score: readiness, effectiveMode: step.effectiveMode, transitions: [...transitions] };
  });
}
