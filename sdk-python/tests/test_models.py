import pytest
from pydantic import ValidationError

from provable_sdk import Cost, Decision, Outcome, Source, Verdict, VerdictKind


def test_valid_decision():
    d = Decision(
        agent_key="a",
        task_key="t",
        source=Source.SDK,
        action={"label": "x"},
        verdict=Verdict(kind=VerdictKind.ACCEPTED),
        outcome=Outcome.SUCCESS,
        confidence=0.9,
        cost=Cost(tokens=10, latency_ms=5),
        external_ref="r1",
    )
    assert d.agent_key == "a"
    assert d.source is Source.SDK


def test_magnitude_only_on_overridden():
    Verdict(kind=VerdictKind.OVERRIDDEN, magnitude=0.5)  # ok
    with pytest.raises(ValidationError):
        Verdict(kind=VerdictKind.ACCEPTED, magnitude=0.5)


def test_magnitude_range():
    with pytest.raises(ValidationError):
        Verdict(kind=VerdictKind.OVERRIDDEN, magnitude=1.5)


def test_confidence_range():
    with pytest.raises(ValidationError):
        Decision(agent_key="a", task_key="t", source=Source.SDK, confidence=2.0)


def test_unknown_field_rejected():
    with pytest.raises(ValidationError):
        Decision(agent_key="a", task_key="t", source=Source.SDK, bogus=1)


def test_invalid_source_rejected():
    with pytest.raises(ValidationError):
        Decision(agent_key="a", task_key="t", source="not_a_source")
