"""The Python honesty gate: every Pydantic enum must EXACTLY match the committed
contract-manifest.json (extra OR missing member = fail). The manifest is generated
from the TS const arrays, and the TS side has its own manifest-sync test — two guards
across the language boundary."""

import json
from pathlib import Path

import pytest

from provable_sdk.models import (
    AgentIdentityState,
    AutonomyMode,
    Outcome,
    Source,
    TransitionDirection,
    TransitionStatus,
    TransitionTrigger,
    VerdictKind,
)

MANIFEST_PATH = (
    Path(__file__).resolve().parents[2] / "packages" / "contracts" / "contract-manifest.json"
)
MANIFEST = json.loads(MANIFEST_PATH.read_text())


def _members(enum: type) -> set[str]:
    return {member.value for member in enum}


CASES = [
    (VerdictKind, "verdictKinds"),
    (Outcome, "outcomes"),
    (Source, "sources"),
    (AutonomyMode, "autonomyModes"),
    (AgentIdentityState, "agentIdentityStates"),
    (TransitionDirection, "transitionDirections"),
    (TransitionTrigger, "transitionTriggers"),
    (TransitionStatus, "transitionStatuses"),
]


@pytest.mark.parametrize("enum, key", CASES, ids=[k for _, k in CASES])
def test_python_enum_matches_manifest(enum: type, key: str) -> None:
    assert _members(enum) == set(MANIFEST[key]), (
        f"{enum.__name__} drifted from manifest['{key}']: "
        f"python={sorted(_members(enum))} manifest={sorted(MANIFEST[key])}"
    )
