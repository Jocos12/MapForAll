"""Collapse the same real venue when it arrives from more than one source.

Two records are the same place when any of these hold:

- they share a Google place id (``place_id``, ``google_place_id``, or ``maps_place_id``)
- the normalized names match and they are under 150 meters apart
- the normalized names and the normalized addresses both match
- they are under 30 meters apart and the name similarity is at least 0.85

Noise words are removed only for the similarity comparison. Display names stay
as they arrived.
"""

from __future__ import annotations

import json
import math
import re
import unicodedata
from difflib import SequenceMatcher
from typing import Any

NAME_DISTANCE_M = 150.0
SIMILAR_DISTANCE_M = 30.0
NAME_SIMILARITY = 0.85
_NOISE = frozenset({"hotel", "restaurant", "cafe", "the", "le", "la"})
_GOOGLE_SOURCES = frozenset({"official", "maps", "google", "google_maps"})
_ID_FIELDS = ("place_id", "google_place_id", "maps_place_id")


def normalize_name(value: str | None) -> str:
    """Lowercase, strip accents and punctuation, collapse spaces."""
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _similarity_name(value: str | None) -> str:
    parts = [word for word in normalize_name(value).split() if word not in _NOISE]
    return " ".join(parts)


def _coords(place: dict[str, Any]) -> tuple[float, float] | None:
    coords = place.get("coordinates")
    lat = lng = None
    if isinstance(coords, dict):
        lat, lng = coords.get("lat"), coords.get("lng")
    elif isinstance(place.get("location"), dict):
        raw = place["location"].get("coordinates")
        if isinstance(raw, (list, tuple)) and len(raw) >= 2:
            lng, lat = raw[0], raw[1]
    if lat is None and place.get("latitude") is not None:
        lat, lng = place.get("latitude"), place.get("longitude")
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return None
    if not math.isfinite(lat) or not math.isfinite(lng):
        return None
    if abs(lat) > 90 or abs(lng) > 180:
        return None
    if lat == 0 and lng == 0:
        return None
    return float(lat), float(lng)


def _haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    radius = 6_371_000.0
    lat1, lng1 = math.radians(a[0]), math.radians(a[1])
    lat2, lng2 = math.radians(b[0]), math.radians(b[1])
    dlat = lat2 - lat1
    dlng = lng2 - lng1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 2 * radius * math.asin(min(1.0, math.sqrt(h)))


def _identity_ids(place: dict[str, Any]) -> set[str]:
    found: set[str] = set()
    for field in _ID_FIELDS:
        value = place.get(field)
        if isinstance(value, str):
            token = value.strip()
            if token and not token.startswith("__"):
                found.add(token)
    return found


def _blank(value: Any) -> bool:
    return value is None or value == "" or value == [] or value == {}


def _is_google(place: dict[str, Any]) -> bool:
    source = str(place.get("source") or "").lower()
    if source in _GOOGLE_SOURCES:
        return True
    for token in _identity_ids(place):
        if token.startswith("ChIJ") and "_hodari_" not in token:
            return True
    return False


def _rating(place: dict[str, Any]) -> float | None:
    rating = place.get("rating")
    if rating is None and isinstance(place.get("ratings"), dict):
        rating = place["ratings"].get("score")
    if isinstance(rating, (int, float)) and math.isfinite(rating):
        return float(rating)
    return None


def _review_count(place: dict[str, Any]) -> int | None:
    for key in ("user_ratings_total", "userRatingCount", "review_count"):
        value = place.get(key)
        if isinstance(value, (int, float)) and value >= 0:
            return int(value)
    ratings = place.get("ratings")
    if isinstance(ratings, dict):
        count = ratings.get("count")
        if isinstance(count, (int, float)) and count >= 0:
            return int(count)
    return None


def _sources(place: dict[str, Any]) -> list[str]:
    raw = place.get("sources")
    found: list[str] = []
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, str) and item and item not in found:
                found.append(item)
    source = place.get("source")
    if isinstance(source, str) and source and source not in found:
        found.append(source)
    return found or ["unknown"]


def _richness(place: dict[str, Any]) -> int:
    score = 0
    source = str(place.get("source") or "")
    place_id = str(place.get("place_id") or "")
    if source in {"owner_claimed", "user_submitted"} or place.get("claimed_by_owner") is True or place_id.startswith("user_"):
        score += 8
    if place.get("photo_url") or place.get("photos"):
        score += 3
    if _rating(place) is not None:
        score += 2
    if place.get("hours") or place.get("hours_week"):
        score += 2
    if place.get("access") or place.get("accessible"):
        score += 2
    pid = str(place.get("place_id") or "")
    if pid and not pid.startswith("user_") and "_hodari_" not in pid:
        score += 2
    if place.get("summary") or place.get("description"):
        score += 1
    if place.get("address"):
        score += 1
    if place.get("phone") or place.get("website"):
        score += 1
    return score


def _addresses_match(left: str | None, right: str | None) -> bool:
    """Equal addresses, or a city-only address that is a suffix of the other."""
    a = normalize_name(left)
    b = normalize_name(right)
    if not a or not b:
        return False
    if a == b:
        return True
    short, long = (a, b) if len(a) <= len(b) else (b, a)
    return long.endswith(" " + short)


def same_place(left: dict[str, Any], right: dict[str, Any]) -> bool:
    """True when both records describe one venue."""
    if not isinstance(left, dict) or not isinstance(right, dict):
        return False
    shared = _identity_ids(left) & _identity_ids(right)
    if shared:
        return True

    name_left = normalize_name(str(left.get("name") or ""))
    name_right = normalize_name(str(right.get("name") or ""))
    addr_left = normalize_name(str(left.get("address") or ""))
    addr_right = normalize_name(str(right.get("address") or ""))
    if name_left and name_left == name_right and _addresses_match(addr_left, addr_right):
        return True

    coords_left = _coords(left)
    coords_right = _coords(right)
    distance = _haversine_m(coords_left, coords_right) if coords_left and coords_right else None
    if name_left and name_left == name_right and distance is not None and distance < NAME_DISTANCE_M:
        return True
    if distance is not None and distance < SIMILAR_DISTANCE_M:
        sim_left = _similarity_name(str(left.get("name") or ""))
        sim_right = _similarity_name(str(right.get("name") or ""))
        if sim_left and sim_right and SequenceMatcher(None, sim_left, sim_right).ratio() >= NAME_SIMILARITY:
            return True
    return False


def _or_access(left: dict[str, Any], right: dict[str, Any]) -> dict[str, bool] | None:
    merged: dict[str, bool] = {}
    seen = False
    for place in (left, right):
        access = place.get("access")
        if not isinstance(access, dict):
            continue
        seen = True
        for key in ("entrance", "toilet", "parking"):
            merged[key] = bool(merged.get(key)) or access.get(key) is True
    return merged if seen else None


def merge_places(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    """Keep the richer record, fill gaps, and never drop a true inclusion flag."""
    primary, secondary = (left, right) if _richness(left) >= _richness(right) else (right, left)
    merged = dict(primary)
    for key, value in secondary.items():
        if key in {"sources", "source"}:
            continue
        if _blank(merged.get(key)) and not _blank(value):
            merged[key] = value

    merged["local_business"] = bool(left.get("local_business")) or bool(right.get("local_business"))
    merged["accessible"] = bool(left.get("accessible")) or bool(right.get("accessible"))
    access = _or_access(left, right)
    if access is not None:
        merged["access"] = access
        if access.get("entrance"):
            merged["accessible"] = True

    scores = []
    for place in (left, right):
        raw = place.get("personalization_score")
        if isinstance(raw, (int, float)) and math.isfinite(raw):
            scores.append(float(raw))
    if scores:
        merged["personalization_score"] = max(scores)

    google = [place for place in (left, right) if _is_google(place) and _rating(place) is not None]
    if google:
        chosen = max(google, key=lambda place: (_review_count(place) or 0, _rating(place) or 0))
        merged["rating"] = _rating(chosen)
        count = _review_count(chosen)
        if count is not None:
            merged["user_ratings_total"] = count

    sources: list[str] = []
    for label in _sources(left) + _sources(right):
        if label not in sources:
            sources.append(label)
    merged["sources"] = sources
    if not merged.get("name"):
        merged["name"] = secondary.get("name") or primary.get("name") or ""
    return merged


def dedupe_places(places: list[dict[str, Any]] | None, limit: int | None = None) -> list[dict[str, Any]]:
    """Return unique places in input order (best-ranked first).

    ``limit`` keeps the first that many unique venues, so a caller that passes
    the full ranked pool backfills after duplicates collapse.
    """
    kept: list[dict[str, Any]] = []
    for place in places or []:
        if not isinstance(place, dict):
            continue
        match_at = next((index for index, existing in enumerate(kept) if same_place(existing, place)), None)
        if match_at is None:
            copy = dict(place)
            copy["sources"] = _sources(place)
            kept.append(copy)
        else:
            kept[match_at] = merge_places(kept[match_at], place)
    if limit is not None and limit >= 0:
        return kept[:limit]
    return kept


def find_duplicate(candidate: dict[str, Any], existing: list[dict[str, Any]]) -> dict[str, Any] | None:
    """First stored place that is the same venue as ``candidate``."""
    for place in existing:
        if isinstance(place, dict) and same_place(candidate, place):
            return place
    return None


def duplicate_groups(places: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """Clusters of two or more records that describe one venue."""
    parent = list(range(len(places)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    for i in range(len(places)):
        if not isinstance(places[i], dict):
            continue
        for j in range(i + 1, len(places)):
            if isinstance(places[j], dict) and same_place(places[i], places[j]):
                parent[find(j)] = find(i)

    buckets: dict[int, list[dict[str, Any]]] = {}
    for index, place in enumerate(places):
        if not isinstance(place, dict):
            continue
        buckets.setdefault(find(index), []).append(place)
    return [group for group in buckets.values() if len(group) > 1]


def _parse_json(raw: Any) -> Any:
    if isinstance(raw, (dict, list)):
        return raw
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def rewrite_candidates_json(raw: Any, *, limit: int = 10) -> str | None:
    """Dedupe a CandidateSet array (or ``{places: [...]}``) and return JSON."""
    data = _parse_json(raw)
    if isinstance(data, dict):
        places = data.get("places")
        wrapped = True
    else:
        places = data
        wrapped = False
    if not isinstance(places, list):
        return None
    cleaned = dedupe_places([place for place in places if isinstance(place, dict)], limit=limit)
    payload: Any = {"places": cleaned} if wrapped else cleaned
    return json.dumps(payload, ensure_ascii=False)


def rewrite_itinerary_json(raw: Any) -> str | None:
    """Drop duplicate stops from an itinerary payload. Other fields stay."""
    data = _parse_json(raw)
    if not isinstance(data, dict) or not isinstance(data.get("stops"), list):
        return None
    stops = [stop for stop in data["stops"] if isinstance(stop, dict)]
    data = dict(data)
    data["stops"] = dedupe_places(stops)
    return json.dumps(data, ensure_ascii=False)
