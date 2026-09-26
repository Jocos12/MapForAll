"""Shared shape for the `places` collection inclusion fields.

Existing documents stay valid: missing keys are filled with defaults and
never overwritten when already set. User submissions always start as
`pending` / `user_submitted`.
"""

from __future__ import annotations

import os
from typing import Any

PLACE_STATUSES = ("pending", "validated", "rejected")
PLACE_SOURCES = ("official", "user_submitted")

# Equity bonuses added on top of rating + budget. Configurable so the pitch
# can tune how strongly local / accessible places rise without a code change.
LOCAL_BONUS = float(os.getenv("MAPFORALL_LOCAL_BONUS", "1.5"))
ACCESS_BONUS = float(os.getenv("MAPFORALL_ACCESS_BONUS", "1.0"))

PLACE_DEFAULTS: dict[str, Any] = {
    "local_business": False,
    "accessible": False,
    "status": "validated",
    "source": "official",
    "confirmations_count": 0,
}


def with_place_defaults(doc: dict[str, Any] | None, *, submitted: bool = False) -> dict[str, Any]:
    """Return a copy of `doc` with inclusion fields filled in when absent.

    `submitted=True` forces a community contribution: status pending, source
    user_submitted. Explicit values already on the document are kept, except
    those two fields on a new submission.
    """
    out: dict[str, Any] = dict(doc or {})
    for key, value in PLACE_DEFAULTS.items():
        out.setdefault(key, value)
    if submitted:
        out["status"] = "pending"
        out["source"] = "user_submitted"
        out.setdefault("confirmations_count", 0)
    if out.get("status") not in PLACE_STATUSES:
        raise ValueError(f"invalid place status: {out.get('status')!r}")
    if out.get("source") not in PLACE_SOURCES:
        raise ValueError(f"invalid place source: {out.get('source')!r}")
    if not isinstance(out.get("local_business"), bool):
        raise ValueError("local_business must be a boolean")
    if not isinstance(out.get("accessible"), bool):
        raise ValueError("accessible must be a boolean")
    count = out.get("confirmations_count", 0)
    if isinstance(count, bool) or not isinstance(count, int) or count < 0:
        raise ValueError("confirmations_count must be a non-negative integer")
    lang = out.get("lang_content")
    if lang is not None:
        if not isinstance(lang, dict):
            raise ValueError("lang_content must be an object")
        out["lang_content"] = {
            code: lang[code] for code in ("fr", "en", "rw") if isinstance(lang.get(code), str) and lang[code].strip()
        }
    return out


def inclusion_bonus(place: dict[str, Any], *, prefer_local: bool) -> float:
    """Points added when a place is local and/or physically accessible.

    `prefer_local` raises the local bonus to the full configured value.
    Without that flag, local places still receive half the bonus so they
    surface at equal relevance without drowning an unrelated query.
    Accessible places always receive ACCESS_BONUS. A strict accessibility
    filter is applied by the caller (drop non-accessible places) before scoring.
    """
    bonus = 0.0
    if place.get("local_business") is True:
        bonus += LOCAL_BONUS if prefer_local else LOCAL_BONUS * 0.5
    if place.get("accessible") is True:
        bonus += ACCESS_BONUS
    return bonus
