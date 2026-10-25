"""TTL response cache for LIST_DISCOVERY results.

Identical (or near-identical) place-search queries are common in testing
and when users repeat or refine the same request. Caching the Maps search
result for 20 minutes saves 100% of tokens and Maps API quota on hits.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)

_DEFAULT_TTL_SECONDS = 1200  # 20 minutes


def _normalize(request: str) -> str:
    """Canonical key: lowercase, collapsed whitespace, punctuation stripped."""
    text = request.lower()
    text = re.sub(r"[^\w\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


class _Entry:
    __slots__ = ("value", "expires_at")

    def __init__(self, value: Any, ttl: float) -> None:
        self.value = value
        self.expires_at = time.monotonic() + ttl


class ResponseCache:
    """Thread-safe TTL cache keyed by normalized query string."""

    def __init__(self, ttl: float = _DEFAULT_TTL_SECONDS) -> None:
        self._ttl = ttl
        self._store: dict[str, _Entry] = {}
        self._lock = threading.Lock()

    def get(self, request: str) -> Optional[str]:
        key = _normalize(request)
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            if time.monotonic() > entry.expires_at:
                del self._store[key]
                return None
            return entry.value

    def set(self, request: str, value: str, ttl: float | None = None) -> None:
        keep = self._ttl if ttl is None else ttl
        if keep <= 0:
            return
        key = _normalize(request)
        with self._lock:
            self._store[key] = _Entry(value, keep)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()

    @property
    def size(self) -> int:
        with self._lock:
            return len(self._store)


_cache: Optional[ResponseCache] = None
_cache_lock = threading.Lock()


def get_response_cache() -> ResponseCache:
    global _cache
    if _cache is None:
        with _cache_lock:
            if _cache is None:
                import os
                raw = os.getenv("HODARI_RESPONSE_CACHE_TTL", "")
                try:
                    ttl = float(raw) if raw else _DEFAULT_TTL_SECONDS
                except ValueError:
                    ttl = _DEFAULT_TTL_SECONDS
                # ttl <= 0 means disabled; use a sentinel TTL that never stores
                _cache = ResponseCache(ttl=max(ttl, 0))
    return _cache
