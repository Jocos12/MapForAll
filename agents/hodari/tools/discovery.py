"""Fast LIST_DISCOVERY path: Maps search + Python ranking (no itinerary agent)."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from google.adk.tools import ToolContext

from ..intent import LIST_DISCOVERY
from .maps_client import search_places_async
from .mongo_tools import _user_id, enqueue_preference_saves
from .place_schema import inclusion_bonus
from .response_cache import get_response_cache

logger = logging.getLogger(__name__)

_PRICE_RANK = {
    "PRICE_LEVEL_FREE": 0,
    "PRICE_LEVEL_INEXPENSIVE": 1,
    "PRICE_LEVEL_MODERATE": 2,
    "PRICE_LEVEL_EXPENSIVE": 3,
    "PRICE_LEVEL_VERY_EXPENSIVE": 4,
}


def extract_place_limit(request: str, default: int = 5) -> int:
    direct = re.search(
        r"\b(\d{1,2})\s+(restaurants?|hotels?|cafes?|coffee|bars?|places?)\b",
        request,
        re.I,
    )
    if direct:
        return max(1, min(int(direct.group(1)), 10))
    # "find 2 restaurant near X" or "2 high-end restaurants near X"
    loose = re.search(
        r"\b(\d{1,2})\b.+\b(restaurants?|hotels?|cafes?|coffee|bars?|places?)\b",
        request,
        re.I,
    )
    if loose:
        return max(1, min(int(loose.group(1)), 10))
    return default


def _budget_boost(price_level: str | None, request: str) -> float:
    lower = request.lower()
    if not price_level:
        return 0.0
    rank = _PRICE_RANK.get(price_level, 2)
    if any(w in lower for w in ("big budget", "luxury", "high budget", "splurge", "expensive")):
        return rank * 0.15
    if any(w in lower for w in ("cheap", "budget", "inexpensive", "affordable")):
        return (4 - rank) * 0.15
    return 0.0


# Phrases (and explicit tokens from the client chips) that turn on inclusion modes.
_LOCAL_HINT = re.compile(
    r"prefer_local|local business|commerces? locaux|petit(?:s)? commerce|informel",
    re.I,
)
_ACCESS_HINT = re.compile(
    r"require_accessible|wheelchair|step-free|accessible|mobilit[eé] r[eé]duite",
    re.I,
)


def inclusion_flags(
    request: str,
    *,
    prefer_local: bool | None = None,
    require_accessible: bool | None = None,
) -> tuple[bool, bool]:
    """Resolve inclusion search flags.

    `prefer_local` boosts neighbourhood / informal businesses (full LOCAL_BONUS).
    `require_accessible` drops places that are not marked accessible, instead of
    only nudging their score. Explicit arguments win over text detection.
    """
    if prefer_local is None:
        prefer_local = bool(_LOCAL_HINT.search(request or ""))
    if require_accessible is None:
        require_accessible = bool(_ACCESS_HINT.search(request or ""))
    return prefer_local, require_accessible


def rank_places(
    places: list[dict[str, Any]],
    request: str,
    limit: int,
    *,
    prefer_local: bool | None = None,
    require_accessible: bool | None = None,
) -> list[dict[str, Any]]:
    """Rank places by rating, budget fit, then an inclusion bonus.

    prefer_local: when true (or when the request asks for local businesses),
        local_business places receive the full MAPFORALL_LOCAL_BONUS. Otherwise
        they still receive half of it, so they rise at equal relevance.
    require_accessible: when true (or when the request asks for accessible
        places), non-accessible places are excluded entirely. Accessible places
        that remain also receive MAPFORALL_ACCESS_BONUS.
    """
    prefer, require = inclusion_flags(
        request, prefer_local=prefer_local, require_accessible=require_accessible
    )
    pool = places
    if require:
        pool = [place for place in places if place.get("accessible") is True]

    scored: list[tuple[float, dict[str, Any]]] = []
    for place in pool:
        rating = float(place.get("rating") or 0.0)
        score = rating + _budget_boost(place.get("price_level"), request)
        score += inclusion_bonus(place, prefer_local=prefer)
        scored.append((score, place))
    scored.sort(key=lambda item: item[0], reverse=True)

    seen: set[str] = set()
    ranked: list[dict[str, Any]] = []
    for _, place in scored:
        pid = place.get("place_id") or place.get("name")
        if not pid or pid in seen:
            continue
        seen.add(pid)
        ranked.append(place)
        if len(ranked) >= limit:
            break
    return ranked


async def discover_places(request: str, tool_context: ToolContext) -> str:
    """Search Maps once, rank in Python, store candidates; no itinerary agent."""
    cache = get_response_cache()
    cached = cache.get(request)
    if cached is not None:
        logger.info("LIST_DISCOVERY cache hit for %r", request[:80])
        tool_context.state["intent_type"] = LIST_DISCOVERY
        cached_data = json.loads(cached)
        tool_context.state["candidates"] = json.dumps(
            cached_data.get("candidates", []), ensure_ascii=False
        )
        tool_context.state["itinerary"] = ""
        tool_context.state["plan"] = ""
        return cached

    limit = extract_place_limit(request)
    prefer_local, require_accessible = inclusion_flags(request)
    logger.info(
        "LIST_DISCOVERY fast path: limit=%d prefer_local=%s require_accessible=%s request=%r",
        limit, prefer_local, require_accessible, request[:120],
    )

    try:
        raw_places = await search_places_async(request)
    except Exception as exc:
        logger.exception("LIST_DISCOVERY Maps search failed")
        return json.dumps(
            {
                "intent_type": LIST_DISCOVERY,
                "error": f"Maps search failed: {exc}",
                "candidates": [],
            }
        )

    candidates = rank_places(
        raw_places,
        request,
        limit,
        prefer_local=prefer_local,
        require_accessible=require_accessible,
    )

    if not candidates:
        return json.dumps(
            {
                "intent_type": LIST_DISCOVERY,
                "error": "No places found",
                "candidates": [],
            }
        )

    candidates_json = json.dumps(candidates, ensure_ascii=False)
    tool_context.state["intent_type"] = LIST_DISCOVERY
    tool_context.state["candidates"] = candidates_json
    tool_context.state["itinerary"] = ""
    tool_context.state["plan"] = ""

    try:
        enqueue_preference_saves(_user_id(tool_context), candidates)
    except Exception as exc:
        logger.warning("Background candidate saves failed: %s", exc)

    result = json.dumps(
        {
            "intent_type": LIST_DISCOVERY,
            "candidates": candidates,
            "message": (
                f"Found {len(candidates)} places. Present them as a numbered list with "
                "name, rating, and one-line summary. Do NOT format as a timed itinerary "
                "or include routes unless the user asks to plan a visit."
            ),
        },
        ensure_ascii=False,
    )
    cache.set(request, result)
    return result
