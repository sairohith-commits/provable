"""Pydantic models — a MANUAL mirror of @provable/contracts.

Closed sets are str Enums; their membership is guarded by the drift test against the
committed contract-manifest.json. Decision/VerdictEvent FIELD shape is backstopped by
the API's zod boundary + the integration test (see README).

Field names are idiomatic snake_case; the wire format is camelCase (alias_generator).
"""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel


# ── Closed sets (mirror the const arrays) ────────────────────────────────────
class VerdictKind(StrEnum):
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"
    OVERRIDDEN = "OVERRIDDEN"
    ESCALATED = "ESCALATED"
    FAILED = "FAILED"


class Outcome(StrEnum):
    SUCCESS = "SUCCESS"
    PARTIAL = "PARTIAL"
    FAILURE = "FAILURE"


class Source(StrEnum):
    GATEWAY = "gateway"
    SDK = "sdk"
    CONNECTOR = "connector"
    OTEL = "otel"


class AutonomyMode(StrEnum):
    OBSERVING = "OBSERVING"
    SHADOW = "SHADOW"
    CO_PILOT = "CO_PILOT"
    SOLO = "SOLO"
    SUSPENDED = "SUSPENDED"
    RETIRED = "RETIRED"


class AgentIdentityState(StrEnum):
    DISCOVERED = "DISCOVERED"
    ACTIVE = "ACTIVE"
    DORMANT = "DORMANT"
    RETIRED = "RETIRED"


class TransitionDirection(StrEnum):
    PROMOTION = "PROMOTION"
    DEMOTION = "DEMOTION"
    LATERAL = "LATERAL"


class TransitionTrigger(StrEnum):
    SCORE_CROSS = "SCORE_CROSS"
    DRIFT = "DRIFT"
    GUARDRAIL = "GUARDRAIL"
    SIGNAL_LOSS = "SIGNAL_LOSS"
    MANUAL_OVERRIDE = "MANUAL_OVERRIDE"
    SCHEDULED = "SCHEDULED"


class TransitionStatus(StrEnum):
    PROPOSED = "PROPOSED"
    PENDING_APPROVAL = "PENDING_APPROVAL"
    APPLIED = "APPLIED"
    AUTO_APPLIED = "AUTO_APPLIED"
    REJECTED = "REJECTED"


# ── Base configs ─────────────────────────────────────────────────────────────
class _InputModel(BaseModel):
    """Outbound (validated locally before sending). Unknown fields are rejected."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class _OutputModel(BaseModel):
    """Inbound (parsed from API responses). Unknown fields are ignored (forward-compat)."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")


# ── Canonical inputs ─────────────────────────────────────────────────────────
class Verdict(_InputModel):
    kind: VerdictKind
    magnitude: float | None = None

    @model_validator(mode="after")
    def _validate_magnitude(self) -> Verdict:
        if self.magnitude is not None:
            if self.kind is not VerdictKind.OVERRIDDEN:
                raise ValueError("magnitude is only valid for an OVERRIDDEN verdict")
            if not 0.0 <= self.magnitude <= 1.0:
                raise ValueError("magnitude must be within [0, 1]")
        return self


class Cost(_InputModel):
    tokens: int | None = None
    usd: float | None = None
    latency_ms: int | None = None


class Decision(_InputModel):
    agent_key: str
    task_key: str
    source: Source
    action: Any = None
    at: str | None = None
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    cost: Cost | None = None
    verdict: Verdict | None = None
    outcome: Outcome | None = None
    external_ref: str | None = None
    metadata: dict[str, Any] | None = None


class VerdictEvent(_InputModel):
    source: Source
    external_ref: str
    verdict: Verdict | None = None
    outcome: Outcome | None = None
    at: str | None = None


# ── Lifecycle signals (optional inputs to exercise transitions) ──────────────
class DriftSignal(_InputModel):
    reason: str
    detected_at: str | None = None
    magnitude: float | None = None


class GuardrailTrip(_InputModel):
    guardrail_id: str
    reason: str
    tripped_at: str | None = None


class ManualDecision(_InputModel):
    kind: Literal["APPROVE", "REJECT"]
    approver: str
    at: str | None = None
    reason: str | None = None


class Signals(_InputModel):
    drift: DriftSignal | None = None
    guardrail: GuardrailTrip | None = None
    manual: ManualDecision | None = None


# ── Recompute result (parsed from /track) ────────────────────────────────────
class ScoreComponents(_OutputModel):
    accuracy_rate: float | None = None
    confidence_avg: float | None = None
    override_rate: float | None = None
    escalation_rate: float | None = None


class ScoredReadiness(_OutputModel):
    status: Literal["SCORED"]
    readiness_score: float
    components: ScoreComponents
    implied_band: str
    event_count: int
    resolved_count: int


class InsufficientReadiness(_OutputModel):
    status: Literal["INSUFFICIENT"]
    missing: list[str]
    event_count: int
    resolved_count: int


Readiness = Annotated[
    ScoredReadiness | InsufficientReadiness, Field(discriminator="status")
]


class Transition(_OutputModel):
    org_id: str
    agent_key: str
    task_key: str
    from_mode: AutonomyMode
    to_mode: AutonomyMode
    direction: TransitionDirection
    trigger: TransitionTrigger
    status: TransitionStatus
    reason: str
    at: str
    approver: str | None = None
    actor: str | None = None  # set for MANUAL_OVERRIDE (the authorizing human)


class RecomputeResult(_OutputModel):
    score: Readiness
    effective_mode: AutonomyMode
    transitions: list[Transition]
