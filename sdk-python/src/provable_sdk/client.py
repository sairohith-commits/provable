"""Sync (`Client`) and async (`AsyncClient`) HTTP clients over httpx, sharing `_core`."""

from __future__ import annotations

from typing import Any

import httpx

from . import _core
from .models import Decision, RecomputeResult, Signals, Verdict, VerdictEvent


def _decision_from(decision: Decision | None, fields: dict[str, Any]) -> Decision:
    if decision is not None:
        if fields:
            raise TypeError("pass either a Decision or keyword fields, not both")
        return decision
    return Decision(**fields)  # validates locally (fail fast)


class _Base:
    def __init__(self, base_url: str, api_key: str | None = None, *, timeout: float | None = None):
        self._base_url = base_url.rstrip("/")
        self._api_key = _core.resolve_api_key(api_key)
        self._timeout = _core.DEFAULT_TIMEOUT if timeout is None else timeout

    @property
    def _headers(self) -> dict[str, str]:
        return _core.auth_headers(self._api_key)


class Client(_Base):
    """Synchronous client."""

    def __init__(
        self,
        base_url: str,
        api_key: str | None = None,
        *,
        timeout: float | None = None,
        transport: httpx.BaseTransport | None = None,
    ):
        super().__init__(base_url, api_key, timeout=timeout)
        self._http = httpx.Client(
            base_url=self._base_url, timeout=self._timeout, transport=transport
        )

    def register(self, agent_key: str, task_key: str | None = None) -> dict[str, Any]:
        r = self._http.post(
            "/register", headers=self._headers, json=_core.register_payload(agent_key, task_key)
        )
        return _core.handle_json(r)

    def track(
        self, decision: Decision | None = None, *, signals: Signals | None = None, **fields: Any
    ) -> RecomputeResult:
        d = _decision_from(decision, fields)
        r = self._http.post(
            "/track", headers=self._headers, json=_core.track_payload(d, signals)
        )
        return _core.parse_recompute(_core.handle_json(r))

    def resolve(
        self,
        external_ref: str,
        *,
        source: Any,
        verdict: Verdict | None = None,
        outcome: Any = None,
        at: str | None = None,
        signals: Signals | None = None,
    ) -> RecomputeResult:
        event = VerdictEvent(
            source=source, external_ref=external_ref, verdict=verdict, outcome=outcome, at=at
        )
        r = self._http.post(
            "/track", headers=self._headers, json=_core.resolve_payload(event, signals)
        )
        return _core.parse_recompute(_core.handle_json(r))

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> Client:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()


class AsyncClient(_Base):
    """Asynchronous client."""

    def __init__(
        self,
        base_url: str,
        api_key: str | None = None,
        *,
        timeout: float | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        super().__init__(base_url, api_key, timeout=timeout)
        self._http = httpx.AsyncClient(
            base_url=self._base_url, timeout=self._timeout, transport=transport
        )

    async def register(self, agent_key: str, task_key: str | None = None) -> dict[str, Any]:
        r = await self._http.post(
            "/register", headers=self._headers, json=_core.register_payload(agent_key, task_key)
        )
        return _core.handle_json(r)

    async def track(
        self, decision: Decision | None = None, *, signals: Signals | None = None, **fields: Any
    ) -> RecomputeResult:
        d = _decision_from(decision, fields)
        r = await self._http.post(
            "/track", headers=self._headers, json=_core.track_payload(d, signals)
        )
        return _core.parse_recompute(_core.handle_json(r))

    async def resolve(
        self,
        external_ref: str,
        *,
        source: Any,
        verdict: Verdict | None = None,
        outcome: Any = None,
        at: str | None = None,
        signals: Signals | None = None,
    ) -> RecomputeResult:
        event = VerdictEvent(
            source=source, external_ref=external_ref, verdict=verdict, outcome=outcome, at=at
        )
        r = await self._http.post(
            "/track", headers=self._headers, json=_core.resolve_payload(event, signals)
        )
        return _core.parse_recompute(_core.handle_json(r))

    async def aclose(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> AsyncClient:
        return self

    async def __aexit__(self, *_exc: object) -> None:
        await self.aclose()
