"""Fast LIST_DISCOVERY path: Maps search + Python ranking (no itinerary agent)."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
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
from .maps_client import search_places_async, search_text_places
from .mongo_tools import HODARI_DB, _mcp_tool, _parse_docs, _user_id, enqueue_preference_saves
from .place_dedupe import dedupe_places
from .place_schema import inclusion_bonus
from .query_intent import (
    INCLUDED_TYPE,
    MIN_VECTOR_SCORE,
    draft_reply,
    extract_search_intent,
    final_score,
    is_relevant,
    listing_is_public,
    modifier_only,
    parse_user_location,
    rejection_reason,
    relevance_score,
    search_terms,
    term_variants,
)
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
    "the", "a", "an", "in", "at", "near", "of", "for", "to", "and", "or", "with", "from",
    "find", "show", "me", "please", "looking", "search", "places", "place", "spot", "endroit",
    "kigali", "rwanda", "best", "good", "top", "some", "any", "want", "need", "like",
    "le", "la", "les", "un", "une", "des", "du", "de", "dans", "près", "pres",
    "pour", "avec", "sur", "cherche", "montre", "moi", "svp", "commerces",
    "commerce", "locaux", "local", "accessible", "accessibles",
    "qui", "que", "où", "ou", "est", "sont", "ideal", "idéal",
}

# Synonym groups so "tranquille / travailler / wifi" match a description that
# says "calme, idéal pour travailler, wifi" (local businesses especially).
_SYN_GROUPS: list[list[str]] = [
    ["calme", "tranquille", "tranquility", "quiet", "peaceful", "paisible", "serein", "serene"],
    [
        "travailler", "travail", "work", "working", "laptop", "cowork", "coworking",
        "bureau", "etudier", "étudier", "study",
    ],
    ["wifi", "wi-fi", "internet", "connexion", "online"],
    ["cafe", "café", "coffee", "espresso", "cappuccino"],
    ["accessible", "fauteuil", "wheelchair", "stepfree", "step-free", "pmr"],
    ["pascher", "abordable", "cheap", "budget", "affordable", "inexpensive"],
]

_GROUP_OF: dict[str, list[str]] = {}
for _group in _SYN_GROUPS:
    _norm = [w.lower() for w in _group]
    for _w in _norm:
        _GROUP_OF[_w] = _norm


def _expand_token(token: str) -> list[str]:
    base = list(_GROUP_OF.get(token.lower(), [token.lower()]))
    for variant in term_variants(token):
        if variant not in base:
            base.append(variant)
    return base


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
        if len(out) >= 8:
            break
    return out


def _text_relevance(place: dict[str, Any], request: str) -> float:
    """Score name/description/tags against the ask; description weighs more for locals."""
    tokens = [t.lower() for t in _name_tokens(request)]
    name = str(place.get("name") or "").lower()
    desc = str(place.get("summary") or place.get("description") or "").lower()
    tags = " ".join(t for t in (place.get("tags") or []) if isinstance(t, str)).lower()
    blob = f"{name} {desc} {tags} {place.get('address') or ''}".lower()
    local = bool(place.get("local_business"))
    phrase = (request or "").strip().lower()
    score = 0.0
    if len(phrase) >= 2 and phrase in name:
        score += 12.0
    matched = 0
    for token in tokens:
        variants = _expand_token(token)
        in_name = any(v in name for v in variants)
        in_desc = any(v in desc for v in variants)
        in_rest = any(v in blob for v in variants)
        if not (in_name or in_desc or in_rest):
            continue
        matched += 1
        if in_name:
            score += 4.0
        elif in_desc:
            score += 3.5 if local else 1.5
        else:
            score += 1.0
    min_matched = 2 if len(tokens) >= 3 else 1
    if matched < min_matched and score < 10:
        return 0.0
    return score


def extract_place_limit(request: str, default: int = 5) -> int:
    direct = re.search(
        r"\b(\d{1,2})\s+(restaurants?|hotels?|cafes?|coffee|bars?|places?)\b",
        request,
        re.I,
    )
    if direct:
        return max(1, min(int(direct.group(1)), 10))
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
    """Resolve inclusion search flags."""
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
    """Rank places by rating, budget fit, then an inclusion bonus."""
    prefer, require = inclusion_flags(
        request, prefer_local=prefer_local, require_accessible=require_accessible
    )
    pool = places
    if require:
        pool = [place for place in places if place.get("accessible") is True]

    indexed = list(enumerate(pool))
    intent = extract_search_intent(request)

    def base_key(item: tuple[int, dict[str, Any]]) -> tuple[float, int]:
        index, place = item
        rating = float(place.get("rating") or 0.0)
        return (-(rating + _budget_boost(place.get("price_level"), request)), index)

    def boost_key(item: tuple[int, dict[str, Any]]) -> tuple[float, int]:
        index, place = item
        # Relevance is the gate. Equity and personalization only nudge, capped at +0.25.
        score = final_score(place, intent, prefer_local=prefer)
        score += _budget_boost(place.get("price_level"), request) * 0.01
        return (-score, index)

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
        if final_score(place, intent, prefer_local=prefer) <= 0:
            continue
        seen.add(pid)
        extra = inclusion_bonus(place, prefer_local=prefer)
        moved = rank < base_rank.get(id(place), rank)
        copy = dict(place)
        copy["prioritized"] = extra > 0 and moved
        ranked.append(copy)
        if len(ranked) >= limit:
            break
    return _promote_relevant_local(ranked)


def _promote_relevant_local(ranked: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """A relevant local business is kept inside the first three results."""
    index = next((i for i, place in enumerate(ranked) if place.get("local_business") is True), None)
    if index is None or index < 3:
        return ranked
    place = ranked.pop(index)
    ranked.insert(2, place)
    return ranked


def _doc_to_candidate(doc: dict[str, Any], fallback_category: str | None = None) -> dict[str, Any] | None:
    """Map a Mongo places document to the client Place shape (full listing fidelity)."""
    coords = (doc.get("location") or {}).get("coordinates") or [None, None]
    lng, lat = coords[0], coords[1]
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return None
    if not listing_is_public(doc):
        return None
    place_id = str(doc.get("place_id") or "")
    if not place_id:
        return None
    photo_url = doc.get("photo_url")
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
    description = doc.get("description") if isinstance(doc.get("description"), str) else ""
    summary = doc.get("summary") if isinstance(doc.get("summary"), str) else ""
    return {
        "place_id": place_id,
        "name": doc.get("name") or "",
        "address": doc.get("address") or "Kigali",
        "coordinates": {"lat": float(lat), "lng": float(lng)},
        "categories": [c for c in categories if isinstance(c, str)],
        "rating": doc.get("rating"),
        "price_level": doc.get("price_level"),
        "summary": summary or description or "",
        "description": description or summary or "",
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
        "google_place_id": doc.get("google_place_id") or doc.get("maps_place_id"),
        "maps_place_id": doc.get("maps_place_id"),
        "user_ratings_total": (doc.get("ratings") or {}).get("count") if isinstance(doc.get("ratings"), dict) else doc.get("user_ratings_total"),
        "claimed_by_owner": bool(doc.get("claimed_by_owner")),
        "confirmations_count": int(doc.get("confirmations_count") or 0),
        "personalization_score": 0.0,
        "keywords": [item for item in (doc.get("keywords") or []) if isinstance(item, str)] if isinstance(doc.get("keywords"), list) else [],
        "distance": _format_distance(doc.get("distance_m")),
        "_distance_km": (float(doc["distance_m"]) / 1000.0) if isinstance(doc.get("distance_m"), (int, float)) else None,
    }


def _format_distance(meters: Any) -> str | None:
    if not isinstance(meters, (int, float)):
        return None
    if meters >= 1000:
        return f"{meters / 1000.0:.1f} km"
    return f"{int(meters)} m"


def _public_query(extra: dict[str, Any] | None) -> dict[str, Any]:
    """Status filter and the text/category filter, without one $or replacing the other."""
    if not extra:
        return dict(_PUBLIC_STATUS)
    return {"$and": [dict(_PUBLIC_STATUS), extra]}


def _term_pattern(terms: list[str]) -> str:
    parts = []
    seen: set[str] = set()
    for term in terms:
        cleaned = term.strip().lower()
        if len(cleaned) < 4 or cleaned in seen:
            continue
        seen.add(cleaned)
        parts.append(_escape_regex(cleaned))
        if len(parts) >= 24:
            break
    return "|".join(parts)


def _catalog_find(extra_filter: dict[str, Any], *, limit: int = 40) -> list[dict[str, Any]]:
    """Validated (public) rows matching `extra_filter`. Empty if Mongo is down."""
    filt = _public_query(extra_filter)
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


def _catalog_by_text(request: str) -> list[dict[str, Any]]:
    """Match validated listings by name OR description/tags (with synonyms).

    Exact/phrase name hits are always included. Description matching is
    weighted toward local_business rows so small shops surface from their copy.
    """
    tokens = _name_tokens(request)
    if not tokens:
        return []

    phrase = " ".join(tokens[:3])
    patterns: list[str] = []
    if len(tokens) > 1:
        patterns.append(phrase)
    for token in tokens:
        patterns.extend(_expand_token(token))

    seen_ids: set[str] = set()
    hits: list[dict[str, Any]] = []

    def _add(rows: list[dict[str, Any]]) -> None:
        for row in rows:
            pid = row.get("place_id") or ""
            if pid and pid not in seen_ids:
                seen_ids.add(pid)
                hits.append(row)

    # 1) Phrase / token against name (preserves "Coffee Shop" exact search).
    for pattern in patterns[:12]:
        escaped = _escape_regex(pattern)
        _add(_catalog_find({"name": {"$regex": escaped, "$options": "i"}}, limit=15))
        if len(hits) >= 20:
            break

    # 2) Same tokens against description/summary — prefer local businesses.
    for pattern in patterns[:12]:
        escaped = _escape_regex(pattern)
        text_or = {
            "$or": [
                {"description": {"$regex": escaped, "$options": "i"}},
                {"summary": {"$regex": escaped, "$options": "i"}},
                {"tags": {"$regex": escaped, "$options": "i"}},
            ]
        }
        _add(_catalog_find({**text_or, "local_business": True}, limit=20))
        _add(_catalog_find(text_or, limit=10))
        if len(hits) >= 30:
            break

    scored = [(p, _text_relevance(p, request)) for p in hits]
    scored = [(p, s) for p, s in scored if s > 0]
    scored.sort(key=lambda row: (-row[1], 0 if row[0].get("local_business") else 1))
    return [p for p, _ in scored[:20]]


def _merge_candidates(*groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge every source, then collapse the same venue to one record."""
    flat = [place for group in groups for place in group if isinstance(place, dict)]
    return dedupe_places(flat)


def _text_filter(terms: list[str], category: str | None) -> dict[str, Any]:
    pattern = _term_pattern(terms)
    clauses: list[dict[str, Any]] = []
    if pattern:
        regex = {"$regex": pattern, "$options": "i"}
        clauses.append({
            "$or": [
                {"name": regex},
                {"name_normalized": regex},
                {"description": regex},
                {"summary": regex},
                {"tags": regex},
                {"keywords": regex},
                {"categories": regex},
            ]
        })
    if category:
        clauses.append({"categories": category})
        clauses.append({"keywords": category})
    if not clauses:
        return {}
    if len(clauses) == 1:
        return clauses[0]
    return {"$or": clauses}


def _geo_near(lat: float, lng: float, radius_m: int, extra: dict[str, Any], *, limit: int = 30) -> list[dict[str, Any]]:
    pipeline = [
        {
            "$geoNear": {
                "near": {"type": "Point", "coordinates": [lng, lat]},
                "distanceField": "distance_m",
                "maxDistance": radius_m,
                "spherical": True,
                "query": _public_query(extra or None),
            }
        },
        {"$limit": limit},
        {"$project": {"photos": 0, "embedding": 0}},
    ]
    result = _mcp_tool("aggregate", {"database": HODARI_DB, "collection": "places", "pipeline": pipeline})
    places: list[dict[str, Any]] = []
    for doc in _parse_docs(result):
        candidate = _doc_to_candidate(doc)
        if candidate and candidate.get("name"):
            places.append(candidate)
    return places


def _catalog_by_geo(lat: float, lng: float, terms: list[str], category: str | None) -> tuple[list[dict[str, Any]], str]:
    """Nearest public places: 3 km, then 8 km, then 15 km, until a few matches exist."""
    extra = _text_filter(terms, category)
    found: dict[str, dict[str, Any]] = {}
    used = "geo:none"
    for radius in (3000, 8000, 15000):
        rows = _geo_near(lat, lng, radius, extra)
        for row in rows:
            pid = str(row.get("place_id") or "")
            if pid:
                found.setdefault(pid, row)
        used = f"geo:{radius}"
        if len(found) >= 3:
            break
    logger.info("db path=%s terms=%s hits=%d", used, ",".join(terms[:8]), len(found))
    return list(found.values()), used


def _catalog_for_intent(request: str, intent: Any, lat: float, lng: float) -> tuple[list[dict[str, Any]], str]:
    """Catalog rows for this ask around the user. Keyword hits plus the requested category."""
    terms = search_terms(request, intent)
    category = intent.category or requested_category(request)
    db_path = "geo"
    geo_hits: list[dict[str, Any]] = []
    try:
        geo_hits, db_path = _catalog_by_geo(lat, lng, terms, category)
    except Exception as exc:
        logger.info("geo catalog failed, falling back to text: %s", exc)
        db_path = "text"
    if geo_hits:
        return geo_hits, db_path
    text_hits = _catalog_by_text(request)
    category_hits = _catalog_by_category(category) if category else []
    prefer_local, require_accessible = inclusion_flags(request)
    local_hits = _catalog_find({"local_business": True}, limit=30) if prefer_local else []
    access_hits = _catalog_find({"accessible": True}, limit=30) if require_accessible else []
    return _merge_candidates(text_hits, category_hits, local_hits, access_hits), db_path or "text"


def _vector_for_intent(query: str, tool_context: ToolContext) -> list[dict[str, Any]]:
    """Vector neighbors in seeded host cities, dropped unless the score clears the floor."""
    from .places_tools import find_places_by_vector

    rows = find_places_by_vector(query or "places", "Kigali", tool_context, limit=8)
    kept: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        score = row.get("score")
        try:
            vector_score = float(score) if score is not None else None
        except (TypeError, ValueError):
            vector_score = None
        if vector_score is None or vector_score < MIN_VECTOR_SCORE:
            continue
        row["_relevance"] = vector_score
        row["sources"] = ["vector"]
        kept.append(row)
    return kept


# Central Kigali, used only when the client did not send a location.
_KIGALI_CENTER = (-1.9441, 30.0619)


def _read_last(state: Any) -> dict[str, Any] | None:
    raw = state.get("last_search") if state is not None else None
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return None
        return data if isinstance(data, dict) else None
    return None


def _write_last(state: Any, intent: Any, lat: float, lng: float, shown: list[str]) -> None:
    if not intent.category:
        return
    state["last_search"] = json.dumps(
        {
            "category": intent.category,
            "keywords": list(intent.keywords or [])[:8],
            "maps_query": intent.maps_query,
            "lat": lat,
            "lng": lng,
            "shown": shown[:30],
        }
    )


def _places_text_query(intent: Any, request: str) -> str:
    folded = request.lower()
    if intent.category == "restaurant" and "burger" in folded:
        return "burger"
    if intent.category == "clinic":
        return "hospital"
    if intent.category == "market":
        return "supermarket" if "supermarket" in folded else "market"
    if intent.category:
        return str(intent.category)
    return str(intent.maps_query or request or "places")[:120]


def _partition(places: list[dict[str, Any]], intent: Any) -> tuple[list[dict[str, Any]], list[str]]:
    kept: list[dict[str, Any]] = []
    rejected: list[str] = []
    for place in places:
        if not isinstance(place, dict):
            continue
        name = str(place.get("name") or "unnamed")
        vector_score = place.get("_relevance") if place.get("sources") == ["vector"] else None
        try:
            vector_value = float(vector_score) if vector_score is not None else None
        except (TypeError, ValueError):
            vector_value = None
        score = relevance_score(place, intent, vector_value)
        if score <= 0:
            rejected.append(f"{name}: {rejection_reason(place, intent, vector_value) or 'not relevant'}")
            continue
        copy = dict(place)
        copy["_relevance"] = score
        kept.append(copy)
    return kept, rejected


def _stamp_relevance(places: list[dict[str, Any]], intent: Any) -> list[dict[str, Any]]:
    kept: list[dict[str, Any]] = []
    for place in places:
        if not isinstance(place, dict):
            continue
        vector_score = place.get("_relevance") if place.get("sources") == ["vector"] else None
        try:
            vector_value = float(vector_score) if vector_score is not None else None
        except (TypeError, ValueError):
            vector_value = None
        score = relevance_score(place, intent, vector_value)
        if score <= 0 or not is_relevant(place, intent, vector_value):
            continue
        copy = dict(place)
        copy["_relevance"] = score
        kept.append(copy)
    return kept


def _coarse_query(query: str) -> str:
    """Round any coordinates in the query to about 300 m so nearby asks share a cache entry."""

    def _bucket(match: re.Match[str]) -> str:
        step = 0.0027
        lat = round(float(match.group(1)) / step) * step
        lng = round(float(match.group(2)) / step) * step
        return f"{lat:.4f},{lng:.4f}"

    return re.sub(r"(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)", _bucket, query)


async def _maps_for_intent(query: str) -> list[dict[str, Any]]:
    cache = get_response_cache()
    cache_key = f"maps::{_coarse_query(query)}"
    cached = cache.get(cache_key)
    if cached is not None:
        logger.info("LIST_DISCOVERY Maps cache hit for %r", query[:80])
        data = json.loads(cached)
        return data if isinstance(data, list) else []
    raw = await asyncio.wait_for(search_places_async(query), timeout=4.0)
    if raw:
        cache.set(cache_key, json.dumps(raw, ensure_ascii=False), ttl=300)
    return raw or []


async def _live_places(
    intent: Any, request: str, lat: float, lng: float, modifier: str | None
) -> tuple[list[dict[str, Any]], str]:
    """Places API (New) text search: 3000 m, then 8000 m when that circle is empty."""
    query = _places_text_query(intent, request)
    included = INCLUDED_TYPE.get(intent.category or "")
    open_now = modifier == "open_now"
    page_size = 20 if modifier == "more" else 10
    radii = (1500.0, 3000.0) if modifier == "closer" else (3000.0, 8000.0)
    statuses: list[str] = []
    found: list[dict[str, Any]] = []
    for radius in radii:
        rows, status = await search_text_places(
            query, lat, lng, radius,
            included_type=included, open_now=open_now, page_size=page_size,
        )
        statuses.append(f"{int(radius)}:{status}")
        if status == 400 and included:
            rows, status = await search_text_places(
                query, lat, lng, radius,
                included_type=None, open_now=open_now, page_size=page_size,
            )
            statuses.append(f"{int(radius)}:{status}")
        if rows:
            found = rows
            break
    return found, ",".join(statuses)


def _clarify_payload(request: str) -> str:
    say = "What should I look for near you? A hotel, a restaurant, or something else?"
    return json.dumps({
        "intent_type": LIST_DISCOVERY,
        "candidates": [],
        "places_query": request,
        "say": say,
    })


async def discover_places(request: str, tool_context: ToolContext) -> str:
    """Search the catalog and Maps together, keep only relevant places, no itinerary."""
    started = time.perf_counter()
    last = _read_last(tool_context.state)
    modifier = modifier_only(request)
    search_request = request
    if modifier:
        if not last or not last.get("category"):
            logger.info(
                "search log intent=%s category= keywords= location= catalog=0 vector=0 maps=0 places=0 places_http=skipped rejected=[] total=%.2fs",
                LIST_DISCOVERY, time.perf_counter() - started,
            )
            return _clarify_payload(request)
        search_request = f"{last['category']} {modifier}"
        loc = parse_user_location(request)
        if loc:
            search_request += f"\n[User location: {loc[0]}, {loc[1]}]"

    limit = extract_place_limit(search_request)
    prefer_local, require_accessible = inclusion_flags(request)
    intent = extract_search_intent(search_request)
    category = intent.category or requested_category(search_request)
    coords = parse_user_location(request)
    if coords is None and last and last.get("lat") is not None and last.get("lng") is not None:
        try:
            coords = (float(last["lat"]), float(last["lng"]))
        except (TypeError, ValueError):
            coords = None
    lat, lng = coords or _KIGALI_CENTER
    # Drop the previous turn's cards before this search publishes anything.
    tool_context.state["candidates"] = "[]"
    tool_context.state["places_query"] = request
    tool_context.state["itinerary"] = ""
    tool_context.state["plan"] = ""
    logger.info(
        "LIST_DISCOVERY fast path: limit=%d category=%s open=%s modifier=%s request=%r",
        limit, category, intent.open_query, modifier, request[:120],
    )

    catalog_started = time.perf_counter()
    catalog_task = asyncio.create_task(asyncio.wait_for(
        asyncio.to_thread(_catalog_for_intent, search_request, intent, lat, lng),
        timeout=8.0,
    ))
    vector_task = asyncio.create_task(asyncio.wait_for(
        asyncio.to_thread(_vector_for_intent, intent.vector_query or search_request, tool_context),
        timeout=1.5,
    ))
    catalog_result, vector_result = await asyncio.gather(catalog_task, vector_task, return_exceptions=True)
    catalog: list[dict[str, Any]] = []
    db_path = "skipped"
    if isinstance(catalog_result, tuple):
        catalog, db_path = catalog_result
    elif isinstance(catalog_result, list):
        catalog, db_path = catalog_result, "text"
    vector_rows = vector_result if isinstance(vector_result, list) else []
    if isinstance(catalog_result, Exception):
        logger.info("catalog lookup failed: %s", catalog_result)
    if isinstance(vector_result, Exception):
        logger.info("vector lookup skipped: %s", vector_result)
    catalog_s = time.perf_counter() - catalog_started

    db_merged = _merge_candidates(catalog, vector_rows)
    db_relevant, rejected = _partition(db_merged, intent)
    maps_places: list[dict[str, Any]] = []
    live_places: list[dict[str, Any]] = []
    places_http = "skipped"
    maps_s = 0.0
    maps_query = intent.maps_query or (category_search_query(category) if category else search_request)
    if not db_relevant:
        maps_started = time.perf_counter()
        try:
            live_places, places_http = await _live_places(intent, search_request, lat, lng, modifier)
        except Exception as exc:
            logger.info("Places API search skipped: %s", exc)
            live_places, places_http = [], "error"
        maps_s = time.perf_counter() - maps_started
    elif len(db_relevant) < 3:
        maps_started = time.perf_counter()
        try:
            maps_places = await _maps_for_intent(maps_query)
        except Exception as exc:
            logger.info("LIST_DISCOVERY Maps search skipped: %s", exc)
            maps_places = []
        maps_s = time.perf_counter() - maps_started

    live_kept, live_rejected = _partition(live_places, intent)
    maps_kept, maps_rejected = _partition(maps_places, intent)
    rejected.extend(live_rejected)
    rejected.extend(maps_rejected)
    pooled = _merge_candidates(db_relevant, maps_kept, live_kept)
    if category and not intent.open_query:
        pooled = [place for place in pooled if is_relevant(place, intent)]

    shown = set(str(item) for item in (last or {}).get("shown") or []) if modifier == "more" else set()
    if shown:
        pooled = [
            place for place in pooled
            if str(place.get("place_id") or "") not in shown and str(place.get("name") or "") not in shown
        ]

    rank_started = time.perf_counter()
    candidates = rank_places(
        pooled,
        search_request,
        max(limit, len(pooled)) or limit,
        prefer_local=prefer_local,
        require_accessible=require_accessible,
    )
    candidates = dedupe_places(candidates, limit=min(limit, 10))
    candidates = [place for place in candidates if float(place.get("_relevance") or 0) > 0 or is_relevant(place, intent)]
    if modifier == "cheaper":
        candidates.sort(key=lambda place: _PRICE_RANK.get(str(place.get("price_level") or ""), 9))
    if modifier == "open_now":
        open_rows = [place for place in candidates if place.get("open_now") is not False]
        if open_rows:
            candidates = open_rows
    for place in candidates:
        place.pop("_relevance", None)
        place.pop("_distance_km", None)
    rank_s = time.perf_counter() - rank_started
    total_s = time.perf_counter() - started
    shown_ids = [str(place.get("place_id") or place.get("name") or "") for place in candidates if place.get("place_id") or place.get("name")]
    if modifier == "more" and last:
        shown_ids = list(dict.fromkeys([*list(shown), *shown_ids]))
    _write_last(tool_context.state, intent, lat, lng, shown_ids)
    logger.info(
        "search log intent=%s category=%s keywords=%s db=%s location=%.5f,%.5f catalog=%d vector=%d maps=%d places=%d places_http=%s rejected=%s total=%.2fs",
        LIST_DISCOVERY,
        category or "",
        ",".join(search_terms(search_request, intent)[:8]),
        db_path,
        lat,
        lng,
        len(catalog),
        len(vector_rows),
        len(maps_places),
        len(live_places),
        places_http,
        rejected[:12],
        total_s,
    )
    logger.info(
        "discover timings catalog=%.2fs maps=%.2fs rank=%.2fs total=%.2fs relevant=%d",
        catalog_s, maps_s, rank_s, total_s, len(candidates),
    )

    say = draft_reply(candidates, request, widen=not candidates and places_http != "skipped")
    if not candidates:
        payload: dict[str, Any] = {
            "intent_type": LIST_DISCOVERY,
            "error": "No places found",
            "candidates": [],
            "places_query": request,
            "say": say,
        }
        if category:
            payload["category"] = category
        tool_context.state["intent_type"] = LIST_DISCOVERY
        tool_context.state["candidates"] = "[]"
        return json.dumps(payload)

    candidates_json = json.dumps(candidates, ensure_ascii=False)
    tool_context.state["intent_type"] = LIST_DISCOVERY
    tool_context.state["candidates"] = candidates_json
    tool_context.state["places_query"] = request

    try:
        enqueue_preference_saves(_user_id(tool_context), candidates)
    except Exception as exc:
        logger.warning("Background candidate saves failed: %s", exc)

    return json.dumps(
        {
            "intent_type": LIST_DISCOVERY,
            "places_query": request,
            "candidates": candidates,
            "say": say,
            "message": (
                "Reply with the say field only, in the user's language. "
                "Name only places in candidates. One sentence for the best match, "
                "then at most 3 bullets. No follow-up question. No routes."
            ),
        },
        ensure_ascii=False,
    )
