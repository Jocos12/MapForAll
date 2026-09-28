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

# Public MapForAll visibility (cahier §4.2): validated (or legacy missing status), not paused.
_PUBLIC_STATUS = {
    "$or": [
        {"status": "validated"},
        {"status": {"$exists": False}},
        {"status": None},
    ],
    "paused": {"$ne": True},
}

_STOP_WORDS = {
    "the", "a", "an", "in", "at", "near", "of", "for", "to", "and", "or",
    "find", "show", "me", "please", "looking", "search", "places", "place",
    "kigali", "rwanda", "best", "good", "top", "some", "any",
    "le", "la", "les", "un", "une", "des", "du", "de", "dans", "près", "pres",
    "pour", "avec", "sur", "cherche", "montre", "moi", "svp", "commerces",
    "commerce", "locaux", "local", "accessible", "accessibles",
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


def _escape_regex(text: str) -> str:
    return re.sub(r"[.*+?^${}()|[\]\\]", r"\\\g<0>", text)


def _name_tokens(request: str) -> list[str]:
    words = re.findall(r"[A-Za-zÀ-ÿ0-9']{3,}", request or "")
    out: list[str] = []
    seen: set[str] = set()
    for word in words:
        key = word.lower()
        if key in _STOP_WORDS or key in seen:
            continue
        seen.add(key)
        out.append(word)
        if len(out) >= 6:
            break
    return out


def _doc_to_candidate(doc: dict[str, Any], fallback_category: str | None = None) -> dict[str, Any] | None:
    """Map a Mongo places document to the client Place shape (full listing fidelity)."""
    coords = (doc.get("location") or {}).get("coordinates") or [None, None]
    lng, lat = coords[0], coords[1]
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return None
    place_id = str(doc.get("place_id") or "")
    if not place_id:
        return None
    photo_url = doc.get("photo_url")
    # Owner covers are stored inline as base64; hand the model a URL, not the image.
    if isinstance(photo_url, str) and photo_url.startswith("data:image/"):
        photo_url = f"/api/places/photo?placeId={quote(place_id)}&i=0"
    photo_count = doc.get("photo_count")
    if not isinstance(photo_count, int):
        photos_raw = doc.get("photos")
        photo_count = len(photos_raw) if isinstance(photos_raw, list) else (1 if photo_url else 0)
    photos = [
        f"/api/places/photo?placeId={quote(place_id)}&i={i}"
        for i in range(1, max(0, min(photo_count, 4)))
    ]
    categories = doc.get("categories") or ([fallback_category] if fallback_category else [])
    if not isinstance(categories, list):
        categories = [fallback_category] if fallback_category else []
    access = doc.get("access") if isinstance(doc.get("access"), dict) else None
    accessible = bool(doc.get("accessible")) or bool(access and access.get("entrance") is True)
    return {
        "place_id": place_id,
        "name": doc.get("name") or "",
        "address": doc.get("address") or "Kigali",
        "coordinates": {"lat": float(lat), "lng": float(lng)},
        "categories": [c for c in categories if isinstance(c, str)],
        "rating": doc.get("rating"),
        "price_level": doc.get("price_level"),
        "summary": doc.get("summary") or doc.get("description") or "",
        "maps_url": doc.get("maps_url"),
        "photo_url": photo_url if isinstance(photo_url, str) and photo_url else None,
        "photos": photos,
        "hours": doc.get("hours") if isinstance(doc.get("hours"), str) else None,
        "hours_week": doc.get("hours_week") if isinstance(doc.get("hours_week"), dict) else None,
        "phone": doc.get("phone") if isinstance(doc.get("phone"), str) else None,
        "tags": [t for t in (doc.get("tags") or []) if isinstance(t, str)] if isinstance(doc.get("tags"), list) else [],
        "local_business": bool(doc.get("local_business")),
        "accessible": accessible,
        "access": access,
        "status": doc.get("status") or "validated",
        "source": doc.get("source"),
        "claimed_by_owner": bool(doc.get("claimed_by_owner")),
        "confirmations_count": int(doc.get("confirmations_count") or 0),
        "personalization_score": 0.0,
    }


def _catalog_find(extra_filter: dict[str, Any], *, limit: int = 40) -> list[dict[str, Any]]:
    """Validated (public) Kigali rows matching `extra_filter`. Empty if Mongo is down."""
    filt: dict[str, Any] = {**_PUBLIC_STATUS, **extra_filter}
    try:
        result = _mcp_tool(
            "find",
            {
                "database": HODARI_DB,
                "collection": "places",
                "filter": filt,
                "projection": {"photos": 0},
                "sort": {"claimed_by_owner": -1, "local_business": -1, "created_at": -1},
                "limit": limit,
            },
        )
    except Exception as exc:
        logger.info("catalog lookup skipped: %s", exc)
        return []
    places: list[dict[str, Any]] = []
    for doc in _parse_docs(result):
        candidate = _doc_to_candidate(doc)
        if candidate and candidate.get("name"):
            places.append(candidate)
    return places


def _catalog_by_category(category: str) -> list[dict[str, Any]]:
    return _catalog_find({"categories": category}, limit=40)


def _catalog_by_name(request: str) -> list[dict[str, Any]]:
    """Find validated listings whose name matches tokens from the user request."""
    tokens = _name_tokens(request)
    if not tokens:
        return []
    # Prefer multi-word phrase first (e.g. "Coffee Shop"), then individual tokens.
    phrase = " ".join(tokens[:3])
    patterns = [phrase] if len(tokens) > 1 else []
    patterns.extend(tokens)
    seen_ids: set[str] = set()
    hits: list[dict[str, Any]] = []
    for pattern in patterns:
        escaped = _escape_regex(pattern)
        rows = _catalog_find(
            {"name": {"$regex": escaped, "$options": "i"}},
            limit=20,
        )
        for row in rows:
            pid = row.get("place_id") or ""
            if pid and pid not in seen_ids:
                seen_ids.add(pid)
                hits.append(row)
        if len(hits) >= 15:
            break
    return hits


def _merge_candidates(*groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for group in groups:
        for place in group:
            pid = place.get("place_id") or place.get("name") or ""
            if not pid or pid in seen:
                continue
            seen.add(str(pid))
            out.append(place)
    return out


async def discover_places(request: str, tool_context: ToolContext) -> str:
    """Search Maps once, rank in Python, store candidates; no itinerary agent."""
    limit = extract_place_limit(request)
    prefer_local, require_accessible = inclusion_flags(request)
    category = requested_category(request)
    logger.info(
        "LIST_DISCOVERY fast path: limit=%d category=%s prefer_local=%s require_accessible=%s request=%r",
        limit, category, prefer_local, require_accessible, request[:120],
    )

    # Catalog is re-read every time (no TTL) so a listing validated a minute ago
    # shows up without waiting for any cache. Maps results may still be cached.
    name_hits = _catalog_by_name(request)
    category_hits = _catalog_by_category(category) if category else []
    local_hits = _catalog_find({"local_business": True}, limit=30) if prefer_local else []
    access_hits = _catalog_find({"accessible": True}, limit=30) if require_accessible else []
    catalog = _merge_candidates(name_hits, category_hits, local_hits, access_hits)

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

    # Prefer Mongo catalog (owner listings) ahead of Maps so published businesses
    # are never crowded out by Google ratings alone.
    pooled = _merge_candidates(catalog, raw_places)
    if category:
        pooled = keep_for_category(pooled, category)

    candidates = rank_places(
        pooled,
        request,
        limit,
        prefer_local=prefer_local,
        require_accessible=require_accessible,
    )

    # Guarantee name-matched catalog rows appear even if ranking truncated them.
    if name_hits:
        guaranteed = rank_places(
            name_hits,
            request,
            min(limit, len(name_hits)),
            prefer_local=prefer_local,
            require_accessible=require_accessible,
        )
        candidates = _merge_candidates(guaranteed, candidates)[:limit]

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
