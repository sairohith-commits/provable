"""Shared core used by BOTH the sync and async clients: payload building, auth
headers, API-key resolution, and response parsing. No network here — the clients own
the httpx transport; this module owns everything else."""

from __future__ import annotations

import os
from typing import Any

import httpx

from .exceptions import ProvableAPIError, ProvableConfigError
from .models import Decision, RecomputeResult, Signals, VerdictEvent

DEFAULT_TIMEOUT = 10.0
API_KEY_ENV = "PROVABLE_API_KEY"


def resolve_api_key(explicit: str | None) -> str:
    key = explicit or os.environ.get(API_KEY_ENV)
    if not key:
        raise ProvableConfigError(
            f"No API key provided (pass api_key=... or set {API_KEY_ENV})."
        )
    return key


def auth_headers(api_key: str) -> dict[str, str]:
    # The key is sent as a Bearer token and never logged.
    return {"Authorization": f"Bearer {api_key}", "content-type": "application/json"}


def _dump(model: Any) -> dict[str, Any]:
    return model.model_dump(by_alias=True, exclude_none=True, mode="json")


def register_payload(agent_key: str, task_key: str | None) -> dict[str, Any]:
    body: dict[str, Any] = {"agentKey": agent_key}
    if task_key is not None:
        body["taskKey"] = task_key
    return body


def track_payload(decision: Decision, signals: Signals | None) -> dict[str, Any]:
    body = _dump(decision)
    body["type"] = "decision"
    if signals is not None:
        body["signals"] = _dump(signals)
    return body


def resolve_payload(event: VerdictEvent, signals: Signals | None) -> dict[str, Any]:
    body = _dump(event)
    body["type"] = "verdict"
    if signals is not None:
        body["signals"] = _dump(signals)
    return body


def _safe_json(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return None


def handle_json(response: httpx.Response) -> Any:
    """Raise on non-2xx; otherwise return the parsed JSON body."""
    if response.status_code >= 400:
        body = _safe_json(response)
        message = body.get("error") if isinstance(body, dict) else response.text
        raise ProvableAPIError(response.status_code, str(message), body)
    return _safe_json(response)


def parse_recompute(data: Any) -> RecomputeResult:
    return RecomputeResult.model_validate(data)
