import json

import httpx

from provable_sdk import (
    AsyncClient,
    Client,
    Cost,
    Decision,
    Outcome,
    Source,
    Verdict,
    VerdictEvent,
    VerdictKind,
)
from provable_sdk._core import register_payload, resolve_payload, track_payload

SCORED = {
    "score": {
        "status": "SCORED",
        "readinessScore": 98.75,
        "components": {
            "accuracyRate": 1.0,
            "confidenceAvg": 0.95,
            "overrideRate": 0.0,
            "escalationRate": 0.0,
        },
        "impliedBand": "SOLO",
        "eventCount": 1,
        "resolvedCount": 1,
    },
    "effectiveMode": "SHADOW",
    "transitions": [],
}


# ── Serialization over the shared core ───────────────────────────────────────
def test_track_payload_is_camel_with_type():
    d = Decision(
        agent_key="a",
        task_key="t",
        source=Source.SDK,
        action={"l": 1},
        verdict=Verdict(kind=VerdictKind.ACCEPTED),
        outcome=Outcome.SUCCESS,
        confidence=0.9,
        external_ref="r1",
        cost=Cost(latency_ms=5),
    )
    body = track_payload(d, None)
    assert body["type"] == "decision"
    assert body["agentKey"] == "a"
    assert body["taskKey"] == "t"
    assert body["externalRef"] == "r1"
    assert body["source"] == "sdk"
    assert body["verdict"] == {"kind": "ACCEPTED"}
    assert body["cost"] == {"latencyMs": 5}  # snake→camel, none-fields dropped
    assert "metadata" not in body  # exclude_none


def test_resolve_payload_type_verdict():
    ev = VerdictEvent(
        source=Source.SDK,
        external_ref="r",
        verdict=Verdict(kind=VerdictKind.ACCEPTED),
        outcome=Outcome.SUCCESS,
    )
    body = resolve_payload(ev, None)
    assert body["type"] == "verdict"
    assert body["externalRef"] == "r"
    assert body["outcome"] == "SUCCESS"


def test_register_payload_optional_task():
    assert register_payload("a", None) == {"agentKey": "a"}
    assert register_payload("a", "t") == {"agentKey": "a", "taskKey": "t"}


# ── Both clients over a mock transport (no network) ──────────────────────────
def _handler(request: httpx.Request) -> httpx.Response:
    assert request.headers["authorization"].startswith("Bearer ")
    body = json.loads(request.content) if request.content else {}
    if request.url.path == "/register":
        return httpx.Response(200, json={"ok": True, "agentKey": body.get("agentKey")})
    if request.url.path == "/track":
        assert body.get("type") in ("decision", "verdict")
        return httpx.Response(200, json=SCORED)
    return httpx.Response(404, json={"error": "not found"})


def test_sync_client_over_mock_transport():
    with Client("http://test", "k", transport=httpx.MockTransport(_handler)) as c:
        assert c.register("a", "t")["ok"] is True
        res = c.track(
            agent_key="a",
            task_key="t",
            source=Source.SDK,
            action={},
            verdict=Verdict(kind=VerdictKind.ACCEPTED),
            outcome=Outcome.SUCCESS,
            confidence=0.9,
            external_ref="r1",
        )
        assert res.score.status == "SCORED"
        assert res.score.readiness_score == 98.75
        assert res.effective_mode.value == "SHADOW"


async def test_async_client_over_mock_transport():
    async with AsyncClient("http://test", "k", transport=httpx.MockTransport(_handler)) as c:
        res = await c.track(
            agent_key="a",
            task_key="t",
            source=Source.SDK,
            action={},
            verdict=Verdict(kind=VerdictKind.ACCEPTED),
            outcome=Outcome.SUCCESS,
            confidence=0.9,
            external_ref="r2",
        )
        assert res.score.status == "SCORED"
        assert res.score.components.accuracy_rate == 1.0
