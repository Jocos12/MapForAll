"""One retry policy for Gemini. Callers must not add another retry loop around it."""

from __future__ import annotations

import random
import time
from typing import Any

# Two retries after the first attempt: 0.5 s, then 1.5 s, plus a little jitter.
RETRY_DELAYS_S = (0.5, 1.5)
MAX_RETRIES = 2
REQUEST_BUDGET_S = 12.0


def status_of(error: BaseException) -> int:
    for attr in ("code", "status_code", "status"):
        value = getattr(error, attr, None)
        if isinstance(value, int):
            return value
    text = str(error).lower()
    if "429" in text or "resource_exhausted" in text or "quota" in text:
        return 429
    if "503" in text or "unavailable" in text:
        return 503
    return 0


def retry_after_seconds(error: BaseException) -> float | None:
    response = getattr(error, "response", None)
    headers = getattr(response, "headers", None) if response is not None else None
    if headers is None:
        headers = getattr(error, "headers", None)
    if not headers:
        return None
    raw = headers.get("Retry-After") if hasattr(headers, "get") else None
    if raw is None:
        return None
    try:
        return max(0.0, float(raw))
    except (TypeError, ValueError):
        return None


def retryable_status(code: int) -> bool:
    return code in (429, 503)


def delay_for_attempt(attempt_index: int, error: BaseException, *, now: float, deadline: float) -> float | None:
    """Seconds to wait before attempt_index (0 is the first try, no wait). None means stop."""
    if attempt_index <= 0:
        return 0.0
    if attempt_index > MAX_RETRIES:
        return None
    remaining = deadline - now
    if remaining <= 0:
        return None
    honored = retry_after_seconds(error)
    base = honored if honored is not None else RETRY_DELAYS_S[attempt_index - 1]
    wait = base + random.uniform(0, 0.25)
    if wait > remaining:
        return None
    return wait


class RequestBudget:
    def __init__(self, seconds: float = REQUEST_BUDGET_S) -> None:
        self.deadline = time.monotonic() + seconds

    def expired(self) -> bool:
        return time.monotonic() >= self.deadline

    def wait(self, attempt_index: int, error: BaseException) -> float | None:
        return delay_for_attempt(attempt_index, error, now=time.monotonic(), deadline=self.deadline)


def log_failure_once(logged: dict[str, Any], *, status: int, model: str, attempt: int, detail: str) -> None:
    """Log the real provider error a single time for this request."""
    if logged.get("done"):
        return
    logged["done"] = True
    import logging

    logging.getLogger("hodari.llm").warning(
        "[llm] status=%s model=%s attempt=%s detail=%s",
        status,
        model,
        attempt,
        (detail or "").replace("\n", " ")[:240],
    )
