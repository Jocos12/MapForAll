"""Fast LIST_DISCOVERY path: Maps search + Python ranking (no itinerary agent)."""

from __future__ import annotations

import json
import logging
import re
from typing import Any
from urllib.parse import quote

from google.adk.tools import ToolContext

from ..intent import LIST_DISCOVERY
from .category_match import (
    category_search_query,
    empty_category_message,
    keep_for_category,
    requested_category,
)
from .maps_client import search_places_async
from .mongo_tools import HODARI_DB, _mcp_tool, _parse_docs, _user_id, enqueue_preference_saves
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

    indexed = list(enumerate(pool))

    def base_key(item: tuple[int, dict[str, Any]]) -> tuple[float, int]:
        index, place = item
        rating = float(place.get("rating") or 0.0)
        return (-(rating + _budget_boost(place.get("price_level"), request)), index)

    def boost_key(item: tuple[int, dict[str, Any]]) -> tuple[float, int]:
        index, place = item
        rating = float(place.get("rating") or 0.0)
        extra = inclusion_bonus(place, prefer_local=prefer)
        return (-(rating + _budget_boost(place.get("price_level"), request) + extra), index)

    base_rank = {
        id(place): rank
        for rank, (_, place) in enumerate(sorted(indexed, key=base_key))
    }
    seen: set[str] = set()
    ranked: list[dict[str, Any]] = []
    for rank, (_, place) in enumerate(sorted(indexed, key=boost_key)):
        pid = place.get("place_id") or place.get("name")
        if not pid or pid in seen:
            continue
        seen.add(pid)
        extra = inclusion_bonus(place, prefer_local=prefer)
        moved = rank < base_rank.get(id(place), rank)
        copy = dict(place)
        copy["prioritized"] = extra > 0 and moved
        ranked.append(copy)
        if len(ranked) >= limit:
            break
    return ranked


def _catalog_by_category(category: str) -> list[dict[str, Any]]:
    """Validated Kigali rows whose stored category matches. Empty if Mongo is down."""
    try:
        result = _mcp_tool(
            "find",
            {
                "database": HODARI_DB,
                "collection": "places",
                "filter": {
                    "categories": category,
                    "city": "Kigali",
                    "status": {"$nin": ["pending", "rejected"]},
                    "paused": {"$ne": True},
                },
                "projection": {"photos": 0},
                "sort": {"claimed_by_owner": -1, "created_at": -1},
                "limit": 12,
            },
        )
    except Exception as exc:
        logger.info("catalog category lookup skipped: %s", exc)
        return []
    places: list[dict[str, Any]] = []
    for doc in _parse_docs(result):
        coords = (doc.get("location") or {}).get("coordinates") or [None, None]
        lng, lat = coords[0], coords[1]
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            continue
        place_id = doc.get("place_id") or ""
        photo_url = doc.get("photo_url")
        # Owner covers are stored inline as base64; hand the model a URL, not the image.
        if isinstance(photo_url, str) and photo_url.startswith("data:image/"):
            photo_url = f"/api/places/photo?placeId={quote(place_id)}&i=0"
        places.append(
            {
                "place_id": place_id,
                "name": doc.get("name") or "",
                "address": doc.get("address") or "Kigali",
                "coordinates": {"lat": float(lat), "lng": float(lng)},
                "categories": doc.get("categories") or [category],
                "rating": doc.get("rating"),
                "price_level": doc.get("price_level"),
                "summary": doc.get("summary") or doc.get("description") or "",
                "maps_url": doc.get("maps_url"),
                "photo_url": photo_url,
                "local_business": bool(doc.get("local_business")),
                "accessible": bool(doc.get("accessible")),
                "status": doc.get("status"),
                "source": doc.get("source"),
                "personalization_score": 0.0,
            }
        )
    return places


async def discover_places(request: str, tool_context: ToolContext) -> str:
    """Search Maps once, rank in Python, store candidates; no itinerary agent."""
    limit = extract_place_limit(request)
    prefer_local, require_accessible = inclusion_flags(request)
    category = requested_category(request)
    logger.info(
        "LIST_DISCOVERY fast path: limit=%d category=%s prefer_local=%s require_accessible=%s request=%r",
        limit, category, prefer_local, require_accessible, request[:120],
    )

    # Only the Maps call is cached: the catalog is re-read every time so a
    # listing validated a minute ago shows up without waiting for the TTL.
    catalog = _catalog_by_category(category) if category else []
    maps_query = category_search_query(category) if category else request
    cache = get_response_cache()
    cache_key = f"maps::{maps_query}"
    try:
        cached = cache.get(cache_key)
        if cached is not None:
            logger.info("LIST_DISCOVERY Maps cache hit for %r", maps_query[:80])
            raw_places = json.loads(cached)
        else:
            raw_places = await search_places_async(maps_query)
            if raw_places:
                cache.set(cache_key, json.dumps(raw_places, ensure_ascii=False))
    except Exception as exc:
        logger.exception("LIST_DISCOVERY Maps search failed")
        raw_places = []
        if not catalog:
            return json.dumps(
                {
                    "intent_type": LIST_DISCOVERY,
                    "error": f"Maps search failed: {exc}",
                    "candidates": [],
                }
            )

    pooled = catalog + raw_places
    if category:
        pooled = keep_for_category(pooled, category)

    candidates = rank_places(
        pooled,
        request,
        limit,
        prefer_local=prefer_local,
        require_accessible=require_accessible,
    )

    if not candidates:
        payload: dict[str, Any] = {
            "intent_type": LIST_DISCOVERY,
            "error": "No places found",
            "candidates": [],
        }
        if category:
            payload["category"] = category
            payload["say"] = empty_category_message(category)
        return json.dumps(payload)

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
    return result
