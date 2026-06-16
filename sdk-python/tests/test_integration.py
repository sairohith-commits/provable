"""End-to-end tests against the LIVE local API (Phases 3-4 stack).

Skipped unless PROVABLE_BASE_URL + PROVABLE_API_KEY are set. Exercises BOTH the sync
and async clients against the real recompute loop."""

import os
from datetime import UTC, datetime, timedelta

import pytest

from provable_sdk import (
    AsyncClient,
    AutonomyMode,
    Client,
    Outcome,
    Source,
    Verdict,
    VerdictKind,
)

BASE = os.environ.get("PROVABLE_BASE_URL")
KEY = os.environ.get("PROVABLE_API_KEY")

pytestmark = pytest.mark.integration
needs_api = pytest.mark.skipif(not (BASE and KEY), reason="PROVABLE_BASE_URL/API_KEY not set")


def iso(i: int) -> str:
    return (
        (datetime(2026, 6, 15, tzinfo=UTC) + timedelta(minutes=i))
        .isoformat()
        .replace("+00:00", "Z")
    )


@needs_api
def test_sync_end_to_end():
    assert BASE is not None and KEY is not None
    with Client(BASE, KEY) as c:
        c.register("agent_sync", "classify")
        result = None
        for i in range(12):
            result = c.track(
                agent_key="agent_sync",
                task_key="classify",
                source=Source.SDK,
                action={"label": "x"},
                verdict=Verdict(kind=VerdictKind.ACCEPTED),
                outcome=Outcome.SUCCESS,
                confidence=0.95,
                external_ref=f"sync-{i}",
                at=iso(i),
            )
        assert result is not None
        assert result.score.status == "SCORED"
        # The score/mode evolved: ≥10 resolved+scored decisions exited OBSERVING.
        assert result.effective_mode != AutonomyMode.OBSERVING

        # resolve() resolves a PENDING decision via a verdict event.
        c.track(
            agent_key="agent_sync",
            task_key="classify",
            source=Source.SDK,
            action={},
            verdict=Verdict(kind=VerdictKind.PENDING),
            external_ref="sync-pending",
            at=iso(40),
        )
        resolved = c.resolve(
            "sync-pending",
            source=Source.SDK,
            verdict=Verdict(kind=VerdictKind.ACCEPTED),
            outcome=Outcome.SUCCESS,
            at=iso(41),
        )
        assert resolved.score.status in ("SCORED", "INSUFFICIENT")


@needs_api
async def test_async_end_to_end():
    assert BASE is not None and KEY is not None
    async with AsyncClient(BASE, KEY) as c:
        await c.register("agent_async", "classify")
        result = await c.track(
            agent_key="agent_async",
            task_key="classify",
            source=Source.SDK,
            action={},
            verdict=Verdict(kind=VerdictKind.ACCEPTED),
            outcome=Outcome.SUCCESS,
            confidence=0.9,
            external_ref="async-1",
            at=iso(1),
        )
        assert result.score.status == "SCORED"
        assert result.effective_mode is not None
