"""Direct Maps Grounding Lite MCP client for imperative Python tools."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Optional

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

logger = logging.getLogger(__name__)

MAPS_MCP_URL = os.getenv("MAPS_GROUNDING_MCP_URL", "https://mapstools.googleapis.com/mcp")
_http_clients: dict[int, httpx.AsyncClient] = {}


def _shared_http_client() -> httpx.AsyncClient:
    """One HTTP client per event loop, reused across Maps MCP calls."""
    loop_id = id(asyncio.get_running_loop())
    client = _http_clients.get(loop_id)
    if client is None or client.is_closed:
        client = httpx.AsyncClient(
            headers={"X-Goog-Api-Key": _api_key()},
            timeout=httpx.Timeout(60.0),
        )
        _http_clients[loop_id] = client
    return client


def _api_key() -> str:
    key = os.environ.get("GOOGLE_MAPS_API_KEY")
    if not key:
        raise RuntimeError("GOOGLE_MAPS_API_KEY is not set")
    return key


def _places_api_key() -> str:
    """Key allowed to call Places API (New). The Grounding Lite key is not.

    Locally, the Next.js server key in client/.env.local is used when the
    agent env does not set one. The value is never logged.
    """
    for name in ("GOOGLE_PLACES_API_KEY", "GOOGLE_MAPS_SERVER_KEY"):
        value = (os.environ.get(name) or "").strip()
        if value and not value.startswith("your_"):
            return value
    env_path = Path(__file__).resolve().parents[3] / "client" / ".env.local"
    if env_path.is_file():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, value = line.split("=", 1)
            if name.strip() in ("GOOGLE_PLACES_API_KEY", "GOOGLE_MAPS_SERVER_KEY"):
                value = value.strip().strip('"').strip("'")
                if value and not value.startswith("your_"):
                    os.environ.setdefault(name.strip(), value)
                    return value
    return (os.environ.get("GOOGLE_MAPS_API_KEY") or "").strip()


def _parse_tool_payload(raw: Any) -> Any:
    if isinstance(raw, dict):
        content = raw.get("content") or []
        texts: list[str] = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                texts.append(item.get("text", ""))
        combined = "\n".join(t for t in texts if t).strip()
        if not combined:
            return raw
        try:
            return json.loads(combined)
        except json.JSONDecodeError:
            blocks = re.findall(r"\{[^{}]*\}", combined)
            if blocks:
                try:
                    return [json.loads(b) for b in blocks]
                except json.JSONDecodeError:
                    pass
            return combined
    return raw


async def call_maps_tool_async(tool_name: str, arguments: dict[str, Any]) -> Any:
    """Invoke a Maps Grounding Lite MCP tool via the official MCP HTTP transport."""
    http_client = _shared_http_client()
    async with streamable_http_client(MAPS_MCP_URL, http_client=http_client) as (
            read,
            write,
            _get_session_id,
        ):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool(tool_name, arguments)
                payload = result.model_dump(exclude_none=True, mode="json")
                return _parse_tool_payload(payload)


def call_maps_tool(tool_name: str, arguments: dict[str, Any]) -> Any:
    """Synchronous wrapper for scripts/tests outside an event loop."""
    import asyncio

    return asyncio.run(call_maps_tool_async(tool_name, arguments))


async def search_places_async(
    text_query: str, location_bias: Optional[str] = None
) -> list[dict[str, Any]]:
    """Run one search_places call and return a normalized list of place dicts."""
    args: dict[str, Any] = {"text_query": text_query}
    if location_bias:
        args["location_bias"] = location_bias

    raw = await call_maps_tool_async("search_places", args)
    places = _extract_places(raw)
    logger.info(
        "maps_client.search_places returned %d places for %r", len(places), text_query
    )
    return places


def search_places(text_query: str, location_bias: Optional[str] = None) -> list[dict[str, Any]]:
    """Sync search_places for unit tests and scripts."""
    import asyncio

    return asyncio.run(search_places_async(text_query, location_bias))


_PLACES_TEXT_URL = "https://places.googleapis.com/v1/places:searchText"


def _places_referer() -> str:
    """Browser-restricted Maps keys reject a server call with an empty Referer."""
    referer = (
        os.getenv("PLACES_HTTP_REFERER")
        or os.getenv("PUBLIC_BASE_URL")
        or "http://localhost:3000/"
    ).strip()
    return referer if referer.endswith("/") else referer + "/"


_PLACES_FIELD_MASK = ",".join(
    [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.location",
        "places.types",
        "places.rating",
        "places.userRatingCount",
        "places.priceLevel",
        "places.googleMapsUri",
        "places.websiteUri",
        "places.currentOpeningHours",
        "places.photos",
    ]
)


async def _photo_uri(photo_name: str) -> str | None:
    """Resolve a Places photo resource to a public image URL. The key stays on the server."""
    key = _places_api_key()
    if not photo_name or not key:
        return None
    try:
        response = await _shared_http_client().get(
            f"https://places.googleapis.com/v1/{photo_name}/media",
            params={"maxHeightPx": "480", "skipHttpRedirect": "true"},
            headers={"X-Goog-Api-Key": key, "Referer": _places_referer()},
            timeout=4.0,
        )
    except Exception as exc:
        logger.info("Places photo lookup failed: %s", exc)
        return None
    if response.status_code != 200:
        return None
    try:
        uri = response.json().get("photoUri")
    except Exception:
        return None
    return uri if isinstance(uri, str) and uri.startswith("https://") else None


async def search_text_places(
    text_query: str,
    lat: float,
    lng: float,
    radius_m: float,
    *,
    included_type: str | None = None,
    open_now: bool = False,
    page_size: int = 10,
) -> tuple[list[dict[str, Any]], int]:
    """Places API (New) Text Search biased to a circle around the user.

    Returns (places, http_status). Status 0 means the key is missing and no request was sent.
    """
    places_key = _places_api_key()
    if not places_key:
        logger.info("Places API searchText HTTP 0 query=%r (no API key)", text_query)
        return [], 0

    body: dict[str, Any] = {
        "textQuery": text_query,
        "pageSize": max(1, min(page_size, 20)),
        "locationBias": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": float(radius_m),
            }
        },
    }
    if included_type:
        body["includedType"] = included_type
    if open_now:
        body["openNow"] = True

    try:
        response = await _shared_http_client().post(
            _PLACES_TEXT_URL,
            json=body,
            headers={
                "X-Goog-Api-Key": places_key,
                "X-Goog-FieldMask": _PLACES_FIELD_MASK,
                "Content-Type": "application/json",
                "Referer": _places_referer(),
            },
            timeout=8.0,
        )
    except Exception as exc:
        logger.info("Places API searchText HTTP 0 query=%r radius=%s error=%s", text_query, radius_m, exc)
        return [], 0

    status = response.status_code
    logger.info(
        "Places API searchText HTTP %s query=%r radius=%s type=%s",
        status, text_query, int(radius_m), included_type or "-",
    )
    if status != 200:
        detail = ""
        try:
            err = response.json().get("error") or {}
            detail = f"{err.get('status') or ''} {str(err.get('message') or '')[:200]}".strip()
        except Exception:
            detail = ""
        if detail:
            logger.info("Places API searchText HTTP %s detail=%s", status, detail)
        return [], status

    try:
        payload = response.json()
    except Exception:
        return [], status
    raw_places = payload.get("places") if isinstance(payload, dict) else None
    if not isinstance(raw_places, list):
        return [], status

    normalized = [_normalize_place(item) for item in raw_places if isinstance(item, dict)]
    photo_names: list[str] = []
    for item, place in zip(raw_places, normalized):
        photos = item.get("photos") if isinstance(item, dict) else None
        photo_name = ""
        if isinstance(photos, list) and photos and isinstance(photos[0], dict):
            photo_name = str(photos[0].get("name") or "")
        photo_names.append(photo_name)
        place["source"] = "places_api"
    uris = await asyncio.gather(*(_photo_uri(name) for name in photo_names[:8]))
    for place, uri in zip(normalized, uris):
        if uri:
            place["photo_url"] = uri
    logger.info("Places API searchText HTTP %s returned %d places", status, len(normalized))
    return [place for place in normalized if place.get("name")], status


def _extract_places(raw: Any) -> list[dict[str, Any]]:
    if isinstance(raw, list):
        return [_normalize_place(p) for p in raw if isinstance(p, dict)]
    if isinstance(raw, dict):
        for key in ("places", "results", "candidates"):
            items = raw.get(key)
            if isinstance(items, list):
                return [_normalize_place(p) for p in items if isinstance(p, dict)]
        if raw.get("place_id") or raw.get("id") or raw.get("name"):
            return [_normalize_place(raw)]
    return []


def _plain_name(value: Any) -> str:
    if isinstance(value, dict):
        text = value.get("text") or value.get("name") or ""
        return text if isinstance(text, str) else ""
    return value if isinstance(value, str) else ""


def _name_from_attribution(place: dict[str, Any]) -> str:
    display = _plain_name(place.get("displayName"))
    if display:
        return display
    attribution = place.get("attribution") or {}
    title = attribution.get("title") or ""
    if isinstance(title, str) and title.endswith(" - Google Maps"):
        title = title[: -len(" - Google Maps")].strip()
    if title:
        return title
    raw = _plain_name(place.get("name"))
    if raw.startswith("places/"):
        return ""
    return raw


def _normalize_place(place: dict[str, Any]) -> dict[str, Any]:
    coords = place.get("coordinates") or place.get("location") or {}
    if "lat" not in coords and "latitude" in coords:
        coords = {"lat": coords.get("latitude"), "lng": coords.get("longitude")}

    place_ref = place.get("place_id") or place.get("id") or place.get("place") or ""
    if isinstance(place_ref, str) and place_ref.startswith("places/"):
        place_ref = place_ref.split("/", 1)[-1]

    links = place.get("googleMapsLinks") or {}
    rating = place.get("rating")
    if rating is None and isinstance(place.get("ratings"), dict):
        rating = place["ratings"].get("score")

    # Opening hours (best effort — present only when Grounding Lite returns them).
    open_now: Optional[bool] = None
    for hk in ("currentOpeningHours", "regularOpeningHours", "opening_hours"):
        hours = place.get(hk)
        if isinstance(hours, dict):
            val = hours.get("openNow")
            if val is None:
                val = hours.get("open_now")
            if isinstance(val, bool):
                open_now = val
                break
    if open_now is None and isinstance(place.get("open_now"), bool):
        open_now = place.get("open_now")

    return {
        "place_id": place_ref,
        "name": _name_from_attribution(place),
        "address": place.get("address") or place.get("formattedAddress") or "",
        "coordinates": {
            "lat": float(coords.get("lat") or 0.0),
            "lng": float(coords.get("lng") or 0.0),
        },
        "categories": place.get("categories") or place.get("types") or [],
        "rating": rating,
        "price_level": place.get("price_level") or place.get("priceLevel"),
        "summary": (
            place.get("summary")
            or place.get("generativeSummary")
            or place.get("description")
            or ""
        ),
        "maps_url": (
            place.get("maps_url")
            or place.get("googleMapsUri")
            or links.get("placeUrl")
            or (place.get("attribution") or {}).get("url")
        ),
        "website": (
            place.get("website")
            or place.get("websiteUri")
            or place.get("websiteURI")
        ),
        "open_now": open_now,
        "personalization_score": 0.0,
        "local_business": bool(place.get("local_business")),
        "accessible": bool(place.get("accessible")),
        "status": place.get("status") or "validated",
        "source": place.get("source") or "official",
        "photo_url": place.get("photo_url") or None,
        "user_ratings_total": place.get("user_ratings_total") or place.get("userRatingCount"),
        "google_place_id": place_ref or None,
        "confirmations_count": place.get("confirmations_count") or 0,
    }
