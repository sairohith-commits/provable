"""SDK exceptions."""

from __future__ import annotations

from typing import Any


class ProvableError(Exception):
    """Base class for all SDK errors."""


class ProvableConfigError(ProvableError):
    """Misconfiguration (e.g., missing API key)."""


class ProvableAPIError(ProvableError):
    """The API returned a non-2xx response."""

    def __init__(self, status_code: int, message: str, body: Any = None) -> None:
        self.status_code = status_code
        self.body = body
        super().__init__(f"API error {status_code}: {message}")
